import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);
  private readonly ttlMs = 10 * 60 * 1000;
  private lastPruneAt = 0;
  private readonly fallbackProcessedMessageIds = new Map<string, number>();
  private useDatabaseDeduplication = true;

  constructor(private readonly prisma: PrismaService) {}

  async shouldProcess(messageId: string) {
    const now = Date.now();
    if (!this.useDatabaseDeduplication) {
      return this.shouldProcessInMemory(messageId, now);
    }

    try {
      await this.prune(now);

      await this.prisma.webhookDeduplication.create({
        data: {
          messageId,
          expiresAt: new Date(now + this.ttlMs),
        },
      });

      return true;
    } catch (error) {
      if (this.isDuplicateMessageError(error)) {
        return false;
      }

      if (this.isMissingRelationError(error)) {
        this.useDatabaseDeduplication = false;
        this.logger.warn(
          'Webhook dedupe table is missing. Falling back to in-memory dedupe until the database migration is applied.',
        );

        return this.shouldProcessInMemory(messageId, now);
      }

      throw error;
    }
  }

  private async prune(now: number) {
    if (now - this.lastPruneAt < this.ttlMs) {
      return;
    }

    this.lastPruneAt = now;

    await this.prisma.webhookDeduplication.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(now),
        },
      },
    });
  }

  private shouldProcessInMemory(messageId: string, now: number) {
    this.pruneInMemory(now);

    if (this.fallbackProcessedMessageIds.has(messageId)) {
      return false;
    }

    this.fallbackProcessedMessageIds.set(messageId, now);
    return true;
  }

  private pruneInMemory(now: number) {
    for (const [messageId, timestamp] of this.fallbackProcessedMessageIds.entries()) {
      if (now - timestamp > this.ttlMs) {
        this.fallbackProcessedMessageIds.delete(messageId);
      }
    }
  }

  private isMissingRelationError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '42P01'
    );
  }

  private isDuplicateMessageError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}
