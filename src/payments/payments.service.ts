import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type PaymentOrder = {
  id: string;
  paymentRef: string | null;
};

@Injectable()
export class PaymentsService {
  constructor(private readonly configService: ConfigService) {}

  async createPaymentLink(order: PaymentOrder) {
    const provider = this.configService.get<string>('payments.provider');
    const baseUrl = this.configService.get<string>('app.baseUrl');

    if (provider === 'paystack') {
      const paystackBaseUrl = this.configService.get<string>('payments.paystackBaseUrl');
      return `${paystackBaseUrl}/${order.paymentRef ?? `order-${order.id}`}`;
    }

    return `${baseUrl}/payments/mock/${order.id}`;
  }
}
