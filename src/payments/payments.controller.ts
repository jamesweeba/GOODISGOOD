import { Body, Controller, Get, Headers, Logger, Param, Post, Req } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Request } from 'express';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly configService: ConfigService,
  ) {}

  @Get('mock/:orderId')
  getMockCheckout(@Param('orderId') orderId: string) {
    return {
      provider: 'mock',
      orderId,
      message:
        'This is a mock payment endpoint. Replace the mock provider with Paystack or another gateway for real transactions.',
      status: 'pending',
    };
  }

  @Post('webhook/paystack')
  async handlePaystackWebhook(
    @Body() body: any,
    @Headers('x-paystack-signature') signature: string,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const secret = this.configService.get<string>('payments.paystackSecretKey');
    const rawBody = req.rawBody;

    if (!rawBody) {
      this.logger.warn('Missing raw Paystack webhook body');
      return { status: 'error', message: 'Missing raw webhook body' };
    }
    
    // Verify signature
    const hash = crypto
      .createHmac('sha512', secret!)
      .update(rawBody)
      .digest('hex');

    if (hash !== signature) {
      this.logger.warn('Invalid Paystack signature');
      return { status: 'error', message: 'Invalid signature' };
    }

    this.logger.log(`Received Paystack webhook: ${body.event}`);

    if (body.event === 'charge.success') {
      const orderId = body.data.metadata?.orderId;
      const reference = body.data.reference;

      if (orderId) {
        this.logger.log(`Marking order ${orderId} as paid (Ref: ${reference})`);
        await this.ordersService.markAsPaid(orderId);
      }
    }

    return { status: 'success' };
  }

  @Get('callback')
  handleCallback() {
      return "Payment successful! You can return to WhatsApp now.";
  }
}
