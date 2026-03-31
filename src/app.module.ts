import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { AdminModule } from './admin/admin.module';
import { ChatModule } from './chat/chat.module';
import { configuration, validateEnvironment } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ProductsModule } from './products/products.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
    DatabaseModule,
    ProductsModule,
    PaymentsModule,
    OrdersModule,
    AiModule,
    AdminModule,
    ChatModule,
    WhatsAppModule,
  ],
})
export class AppModule {}
