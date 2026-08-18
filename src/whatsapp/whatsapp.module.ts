import { forwardRef, Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppFlowService } from './whatsapp-flow.service';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [forwardRef(() => ChatModule), ProductsModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, WhatsAppWebhookService, WhatsAppFlowService],
  exports: [WhatsAppService, WhatsAppWebhookService, WhatsAppFlowService],
})
export class WhatsAppModule {}
