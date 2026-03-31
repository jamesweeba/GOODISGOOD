import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersService } from './orders.service';

@Module({
  imports: [PaymentsModule],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}

