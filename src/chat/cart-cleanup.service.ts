import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

/**
 * CartCleanupService
 *
 * Runs on application startup and then every hour to sweep up any expired
 * pending/awaiting_payment carts from the database, keeping the DB lean.
 *
 * This is a lightweight alternative to @nestjs/schedule (which requires Node >= 12).
 * It uses native setInterval so no extra packages are needed.
 */
@Injectable()
export class CartCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CartCleanupService.name);
  private readonly INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsAppService,
    private readonly configService: ConfigService,
  ) {}

  /** Runs once when the NestJS app finishes bootstrapping. */
  onApplicationBootstrap() {
    // Initial sweep on startup
    this.sweepExpiredCarts().catch((e) =>
      this.logger.error('Initial cart sweep failed', e),
    );

    // Recurring sweep every hour
    setInterval(() => {
      this.sweepExpiredCarts().catch((e) =>
        this.logger.error('Hourly cart sweep failed', e),
      );
    }, this.INTERVAL_MS);

    this.logger.log(
      `🧹 CartCleanupService started — sweeping every ${this.INTERVAL_MS / 60000} minutes`,
    );
  }

  /**
   * Deletes all orders that have passed their `expiresAt` timestamp
   * and are still in a pending or awaiting_payment status.
   *
   * Before deleting, it optionally sends an abandoned-cart reminder to the user.
   */
  async sweepExpiredCarts(): Promise<void> {
    const now = new Date();

    // Find expired carts that haven't been notified yet
    const expiredCarts = await this.prisma.order.findMany({
      where: {
        status: { in: ['pending', 'awaiting_payment'] },
        expiresAt: { lt: now, not: null },
      },
      include: {
        items: { include: { product: true } },
      },
    });

    if (expiredCarts.length === 0) {
      this.logger.log('🧹 Cart sweep: no expired carts found.');
      return;
    }

    this.logger.log(
      `🧹 Cart sweep: found ${expiredCarts.length} expired cart(s). Cleaning up...`,
    );

    for (const cart of expiredCarts) {
      try {
        // Cancel the order in the DB
        await this.prisma.order.update({
          where: { id: cart.id },
          data: { status: 'cancelled' },
        });

        // Send a gentle reminder to the user if they had items
        if (cart.items.length > 0) {
          const itemNames = cart.items
            .slice(0, 3)
            .map((i) => i.product.name)
            .join(', ');

          const more = cart.items.length > 3
            ? ` and ${cart.items.length - 3} more`
            : '';

          await this.whatsappService.sendInteractiveButtons(
            cart.userPhone,
            `👋 Hey! Your cart with *${itemNames}${more}* has expired.\n\nWould you like to start a new order?`,
            [
              { id: 'catalog', title: '🛒 Shop Again' },
              { id: 'reorder', title: '🔄 Reorder Last' },
            ],
            '🛍️ Marketix Groceries',
          );
        }
      } catch (e) {
        this.logger.error(
          `Failed to clean up cart ${cart.id} for ${cart.userPhone}`,
          e,
        );
      }
    }

    this.logger.log(
      `🧹 Cart sweep complete: cancelled ${expiredCarts.length} expired cart(s).`,
    );
  }
}
