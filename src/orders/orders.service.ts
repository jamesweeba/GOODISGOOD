import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PaymentsService } from '../payments/payments.service';

export type CartItemInput = {
  name: string;
  quantity: number;
};

@Injectable()
export class OrdersService {
  private lastExpirationSweepAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
  ) {}

  async createOrderMulti(userPhone: string, items: CartItemInput[]) {
    return this.upsertPendingCart(userPhone, items, true);
  }

  async addItemsToCart(userPhone: string, items: CartItemInput[]) {
    const order = await this.getPending(userPhone);

    if (!order) {
      await this.upsertPendingCart(userPhone, items, false);
      return this.viewCart(userPhone);
    }

    const mergedItems = new Map<string, number>();

    for (const item of order.items) {
      mergedItems.set(item.product.name, item.quantity);
    }

    for (const item of items) {
      const currentQuantity = mergedItems.get(item.name) ?? 0;
      mergedItems.set(item.name, currentQuantity + item.quantity);
    }

    await this.updateCart(
      userPhone,
      Array.from(mergedItems.entries()).map(([name, quantity]) => ({
        name,
        quantity,
      })),
    );

    return this.viewCart(userPhone);
  }

  async getPending(userPhone: string) {
    return this.prisma.order.findFirst({
      where: this.activeOrderWhere(userPhone),
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async requestPayment(userPhone: string) {
    const order = await this.getPending(userPhone);
    if (!order || order.items.length === 0) {
      return null;
    }

    const paymentRef = order.paymentRef ?? `order-${order.id}`;
    const paymentUrl = await this.paymentsService.createPaymentLink({
      ...order,
      paymentRef,
    });

    return this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.awaiting_payment,
        paymentRef,
        paymentUrl,
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });
  }

  async createPaymentLinkForPending(userPhone: string) {
    const order = await this.requestPayment(userPhone);
    return order?.paymentUrl ?? null;
  }

  async getPaymentMessage(userPhone: string) {
    const order = await this.requestPayment(userPhone);
    if (!order || order.items.length === 0 || !order.paymentUrl) {
      return null;
    }

    return [
      'Items in your cart:',
      ...order.items.map((item) => {
        const lineTotal = Number(item.product.price) * item.quantity;
        return `${item.product.name} x ${item.quantity} = $${lineTotal.toFixed(2)}`;
      }),
      `Total: $${Number(order.total).toFixed(2)}`,
      '',
      'Complete your payment here:',
      order.paymentUrl,
    ].join('\n');
  }

  async cancelPending(userPhone: string) {
    const order = await this.getPending(userPhone);
    if (!order) {
      return null;
    }

    return this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.cancelled,
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });
  }

  async clearCart(userPhone: string) {
    const order = await this.getPending(userPhone);
    if (!order || order.items.length === 0) {
      return 'Your cart is already empty.';
    }

    await this.prisma.$transaction([
      this.prisma.orderItem.deleteMany({
        where: { orderId: order.id },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          total: new Prisma.Decimal(0),
          status: OrderStatus.cancelled,
        },
      }),
    ]);

    return 'Your cart has been cleared.';
  }

  async viewCart(userPhone: string) {
    const order = await this.getPending(userPhone);
    if (!order || order.items.length === 0) {
      return 'Your cart is empty.';
    }

    const lines = order.items.map((item) => {
      const lineTotal =
        Number(item.product.price) * item.quantity;
      return `${item.product.name} x ${item.quantity} = $${lineTotal.toFixed(2)}`;
    });

    return ['Items in your cart:', ...lines, `Total: $${Number(order.total).toFixed(2)}`].join(
      '\n',
    );
  }

  async updateCart(userPhone: string, items: CartItemInput[]) {
    const order = await this.getPending(userPhone);
    if (!order) {
      return 'Your cart is empty.';
    }

    await this.upsertPendingCart(userPhone, items, false);
    return this.viewCart(userPhone);
  }

  async removeItemsFromCart(userPhone: string, items: CartItemInput[]) {
    const order = await this.getPending(userPhone);
    if (!order || order.items.length === 0) {
      return 'Your cart is empty.';
    }

    const normalizedItems = items
      .map((item) => ({
        name: item.name.trim(),
        quantity: Math.trunc(Number(item.quantity)),
      }))
      .filter((item) => item.name.length > 0 && Number.isFinite(item.quantity) && item.quantity > 0);

    if (!normalizedItems.length) {
      return 'No valid items were provided to remove.';
    }

    const productByName = new Map(
      order.items.map((item) => [item.product.name.toLowerCase(), item]),
    );
    const removedItems: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of normalizedItems) {
        const orderItem = productByName.get(item.name.toLowerCase());
        if (!orderItem) {
          continue;
        }

        if (item.quantity >= orderItem.quantity) {
          await tx.orderItem.delete({
            where: {
              orderId_productId: {
                orderId: order.id,
                productId: orderItem.productId,
              },
            },
          });
          removedItems.push(orderItem.product.name);
          continue;
        }

        await tx.orderItem.update({
          where: {
            orderId_productId: {
              orderId: order.id,
              productId: orderItem.productId,
            },
          },
          data: {
            quantity: orderItem.quantity - item.quantity,
          },
        });

        removedItems.push(`${orderItem.product.name} x ${item.quantity}`);
      }

      const remainingItems = await tx.orderItem.findMany({
        where: { orderId: order.id },
        include: {
          product: true,
        },
      });

      if (remainingItems.length === 0) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            total: new Prisma.Decimal(0),
            status: OrderStatus.cancelled,
          },
        });
        return;
      }

      const total = remainingItems.reduce((sum, item) => {
        return sum.plus(item.product.price.mul(item.quantity));
      }, new Prisma.Decimal(0));

      await tx.order.update({
        where: { id: order.id },
        data: {
          total,
          status: OrderStatus.pending,
          expiresAt: this.nextExpiryDate(),
        },
      });
    });

    if (!removedItems.length) {
      return 'I could not find those items in your cart.';
    }

    return [
      `Removed ${removedItems.join(', ')} from your cart.`,
      await this.viewCart(userPhone),
    ].join('\n');
  }

  async expireOldCarts(hours = this.configService.get<number>('cart.expiryHours', 24)) {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    await this.prisma.order.updateMany({
      where: {
        status: {
          in: [OrderStatus.pending, OrderStatus.awaiting_payment],
        },
        createdAt: {
          lt: cutoff,
        },
      },
      data: {
        status: OrderStatus.expired,
      },
    });
  }

  async maybeExpireOldCarts() {
    const now = Date.now();
    const sweepIntervalMs = 5 * 60 * 1000;

    if (now - this.lastExpirationSweepAt < sweepIntervalMs) {
      return;
    }

    this.lastExpirationSweepAt = now;
    await this.expireOldCarts();
  }

  private async upsertPendingCart(
    userPhone: string,
    items: CartItemInput[],
    replaceExisting: boolean,
  ) {
    if (!items.length) {
      throw new Error('No products were provided.');
    }

    const normalizedItems = items.map((item) => ({
      name: item.name.trim(),
      quantity: Number(item.quantity),
    }));

    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: {
          active: true,
          name: {
            in: normalizedItems.map((item) => item.name),
          },
        },
      });

      if (products.length === 0) {
        throw new Error('No matching products were found.');
      }

      const productByName = new Map(products.map((product) => [product.name.toLowerCase(), product]));

      const resolvedItems = normalizedItems.map((item) => {
        const product = productByName.get(item.name.toLowerCase());
        if (!product) {
          throw new Error(`${item.name} not found`);
        }

        if (!Number.isFinite(item.quantity)) {
          throw new Error(`Quantity is invalid for ${item.name}`);
        }

        return {
          product,
          quantity: Math.trunc(item.quantity),
        };
      });

      let order = await tx.order.findFirst({
        where: this.activeOrderWhere(userPhone),
        include: {
          items: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!order) {
        order = await tx.order.create({
          data: {
            userPhone,
            status: OrderStatus.pending,
            total: new Prisma.Decimal(0),
            expiresAt: this.nextExpiryDate(),
          },
          include: {
            items: true,
          },
        });
      }

      if (replaceExisting && order.items.length > 0) {
        await tx.orderItem.deleteMany({
          where: { orderId: order.id },
        });
      }

      for (const item of resolvedItems) {
        if (item.quantity <= 0) {
          await tx.orderItem.deleteMany({
            where: {
              orderId: order.id,
              productId: item.product.id,
            },
          });
          continue;
        }

        await tx.orderItem.upsert({
          where: {
            orderId_productId: {
              orderId: order.id,
              productId: item.product.id,
            },
          },
          create: {
            orderId: order.id,
            productId: item.product.id,
            quantity: item.quantity,
          },
          update: {
            quantity: item.quantity,
          },
        });
      }

      const updatedItems = await tx.orderItem.findMany({
        where: { orderId: order.id },
        include: {
          product: true,
        },
      });

      if (updatedItems.length === 0) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            total: new Prisma.Decimal(0),
            status: OrderStatus.cancelled,
          },
        });

        return tx.order.findUniqueOrThrow({
          where: { id: order.id },
          include: {
            items: {
              include: { product: true },
            },
          },
        });
      }

      const total = updatedItems.reduce((sum, item) => {
        return sum.plus(item.product.price.mul(item.quantity));
      }, new Prisma.Decimal(0));

      return tx.order.update({
        where: { id: order.id },
        data: {
          total,
          status: OrderStatus.pending,
          expiresAt: this.nextExpiryDate(),
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });
    });
  }

  private nextExpiryDate() {
    const hours = this.configService.get<number>('cart.expiryHours', 24);
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private activeOrderWhere(userPhone: string): Prisma.OrderWhereInput {
    return {
      userPhone,
      status: {
        in: [OrderStatus.pending, OrderStatus.awaiting_payment],
      },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };
  }
}
