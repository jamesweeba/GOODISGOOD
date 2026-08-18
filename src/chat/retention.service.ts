import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { OrdersService } from '../orders/orders.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private lastAbandonedCheck = 0;
  private lastNewArrivalCheck = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsAppService,
    private readonly ordersService: OrdersService,
  ) {}

  async runRetentionChecks() {
    const now = Date.now();
    
    // Check for abandoned carts every 1 hour
    if (now - this.lastAbandonedCheck > 60 * 60 * 1000) {
      await this.recoverAbandonedCarts();
      this.lastAbandonedCheck = now;
    }

    // Check for new arrivals every 24 hours
    if (now - this.lastNewArrivalCheck > 24 * 60 * 60 * 1000) {
      await this.notifyNewArrivals();
      this.lastNewArrivalCheck = now;
    }
  }

  async recoverAbandonedCarts() {
    this.logger.log('Running abandoned cart recovery...');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

    const abandonedOrders = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.pending, OrderStatus.awaiting_payment] },
        updatedAt: {
          lt: twoHoursAgo,
          gt: sixHoursAgo, // Only recover relatively fresh abandoned carts
        },
      },
      include: { items: { include: { product: true } } },
    });

    for (const order of abandonedOrders) {
      const summary = order.items.map(i => `${i.product.name} x ${i.quantity}`).join(', ');
      const message = `Hi! We noticed you left some items in your cart: ${summary}.\n\nWould you like to complete your order? Type "cart" to view it or "checkout" to finish now!`;
      
      try {
        await this.whatsappService.sendMessage(order.userPhone, message);
        // Mark as "notified" by updating updatedAt so we don't spam
        await this.prisma.order.update({
            where: { id: order.id },
            data: { updatedAt: new Date() } 
        });
      } catch (e) {
        this.logger.error(`Failed to send recovery message to ${order.userPhone}`, e);
      }
    }
  }

  async notifyNewArrivals() {
    this.logger.log('Checking for new arrivals to notify customers...');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const newProducts = await this.prisma.product.findMany({
      where: { createdAt: { gt: yesterday }, active: true },
    });

    if (newProducts.length === 0) return;

    // Get active users from last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentUsers = await this.prisma.userProfile.findMany({
      where: { updatedAt: { gt: thirtyDaysAgo } },
    });

    const productNames = newProducts.map(p => `*${p.name}*`).join(', ');
    const message = `🌟 *New Arrivals!* 🌟\n\nWe've just added some new items you might love: ${productNames}.\n\nType "list" to see our full catalog!`;

    for (const user of recentUsers) {
      try {
        await this.whatsappService.sendMessage(user.phone, message);
        if (newProducts[0].imageUrl) {
            await this.whatsappService.sendImage(user.phone, newProducts[0].imageUrl, `Check out ${newProducts[0].name}!`);
        }
      } catch (e) {
        this.logger.warn(`Failed to notify ${user.phone} of new arrivals`);
      }
    }
  }

  async offerReorderIfFrequent(userPhone: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { phone: userPhone } });
    if (!profile || profile.purchaseCount < 2) return null;

    const lastOrder = await this.prisma.order.findFirst({
        where: { userPhone, status: OrderStatus.paid },
        orderBy: { createdAt: 'desc' },
    });

    if (!lastOrder) return null;

    // If it's been more than 7 days since last order, offer reorder
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (lastOrder.createdAt < sevenDaysAgo) {
        return "Welcome back! It's been a while since your last purchase. Would you like to repeat your last order? Just say 'reorder last'!";
    }
    
    return null;
  }
}
