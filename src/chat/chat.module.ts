import { forwardRef, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ChatService } from './chat.service';

@Module({
  imports: [AiModule, OrdersModule, ProductsModule, forwardRef(() => WhatsAppModule)],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
