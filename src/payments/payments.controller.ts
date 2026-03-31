import { Controller, Get, Param } from '@nestjs/common';

@Controller('payments')
export class PaymentsController {
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
}
