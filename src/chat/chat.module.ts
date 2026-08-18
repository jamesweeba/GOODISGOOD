import { forwardRef, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { CartCleanupService } from './cart-cleanup.service';
import { ChatService } from './chat.service';
import { RetentionService } from './retention.service';

@Module({
  imports: [AiModule, OrdersModule, ProductsModule, forwardRef(() => WhatsAppModule)],
  providers: [ChatService, RetentionService, CartCleanupService],
  exports: [ChatService, RetentionService],
})
export class ChatModule {}

