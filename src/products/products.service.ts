import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAvailableProducts() {
    return this.prisma.product.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        price: true,
        description: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}
