import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardData() {
    const [
      productCount,
      sessionCount,
      activeOrderCount,
      recentChats,
      recentOrders,
      sessions,
      activeOrders,
    ] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.userSession.count(),
      this.prisma.order.count({
        where: {
          status: {
            in: [OrderStatus.pending, OrderStatus.awaiting_payment],
          },
        },
      }),
      this.prisma.chatHistory.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          items: {
            include: { product: true },
          },
        },
      }),
      this.prisma.userSession.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      this.prisma.order.findMany({
        where: {
          status: {
            in: [OrderStatus.pending, OrderStatus.awaiting_payment],
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        include: {
          items: {
            include: { product: true },
          },
        },
      }),
    ]);

    return {
      productCount,
      sessionCount,
      activeOrderCount,
      recentChats,
      recentOrders,
      sessions,
      activeOrders,
    };
  }

  formatMoney(value: Prisma.Decimal | number | string) {
    return Number(value).toFixed(2);
  }
}
