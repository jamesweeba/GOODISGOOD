import { forwardRef, Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [forwardRef(() => ChatModule)],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, WhatsAppWebhookService],
  exports: [WhatsAppService, WhatsAppWebhookService],
})
export class WhatsAppModule {}
