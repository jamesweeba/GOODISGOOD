import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAvailableProducts() {
    return this.prisma.product.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async findByIds(ids: string[]) {
    return this.prisma.product.findMany({
      where: { id: { in: ids }, active: true },
    });
  }

  async searchProducts(query: string | string[]) {
    const queryString = Array.isArray(query) ? query.join(' ') : (query || '');
    const terms = queryString.split(/\s+/).filter((t) => t.length > 2);
    if (terms.length === 0) {
      return this.prisma.product.findMany({
        where: { active: true },
      });
    }

    return this.prisma.product.findMany({
      where: {
        active: true,
        OR: terms.map((term) => ({
          OR: [
            { name: { contains: term, mode: 'insensitive' as any } },
            { description: { contains: term, mode: 'insensitive' as any } },
          ],
        })),
      },
    });
  }

  /** Returns distinct non-empty categories from active products, sorted A-Z. */
  async listCategories(): Promise<string[]> {
    const rows = await this.prisma.product.findMany({
      where: { active: true, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    return rows
      .map((r) => r.category as string)
      .filter((c) => c && c.trim().length > 0);
  }

  /** Returns active products filtered by category (case-insensitive), sorted A-Z. */
  async listByCategory(category: string) {
    return this.prisma.product.findMany({
      where: {
        active: true,
        category: { equals: category, mode: 'insensitive' as any },
      },
      orderBy: { name: 'asc' },
    });
  }
}
