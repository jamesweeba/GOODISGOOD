import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ChatService } from '../chat/chat.service';
import { ConfigService } from '@nestjs/config';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { WhatsAppService } from './whatsapp.service';

type WhatsAppMessage = {
  id?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  text?: {
    body?: string;
  };
};

type WhatsAppWebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppMessage[];
      };
    }>;
  }>;
};

@Controller('webhook')
export class WhatsAppController {
  constructor(
    private readonly chatService: ChatService,
    private readonly configService: ConfigService,
    private readonly webhookService: WhatsAppWebhookService,
    private readonly whatsappService: WhatsAppService,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.challenge') challenge?: string,
    @Query('hub.verify_token') verifyToken?: string,
  ) {
    const expectedToken = this.configService.get<string>('whatsapp.verifyToken');
    if (mode === 'subscribe' && verifyToken === expectedToken) {
      return challenge ?? '';
    }

    return 'Verification failed';
  }

  @Post()
  @HttpCode(200)
  async receiveMessage(
    @Body() body: WhatsAppWebhookBody,
    @Req() _req: Request,
    @Headers('x-hub-signature-256') _signature?: string,
  ) {
    const messages =
      body.entry?.flatMap(
        (entry) =>
          entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? [],
      ) ?? [];

    for (const msg of messages) {
      if (!msg || msg.type !== 'text' || !msg.from || !msg.text?.body) {
        continue;
      }

      const messageId =
        msg.id ??
        `${msg.from}:${msg.timestamp ?? 'unknown'}:${msg.text.body.trim()}`;

      if (!(await this.webhookService.shouldProcess(messageId))) {
        continue;
      }

      if (msg.id) {
        const messageId = msg.id;
        void (async () => {
          const typingShown = await this.whatsappService.sendTypingIndicator(messageId);

          if (typingShown) {
            await this.sleep(
              Number(this.configService.get<number>('whatsapp.typingIndicatorDelayMs', 1200)),
            );
          }

          await this.chatService.handleMessage(msg.from!, msg.text!.body!);
        })().catch(() => {
          return;
        });
        continue;
      }

      void this.chatService.handleMessage(msg.from, msg.text.body).catch(() => {
        return;
      });
    }

    return { received: true };
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
