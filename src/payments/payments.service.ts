import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

type PaymentOrder = {
  id: string;
  paymentRef: string;
  total: number;
  userPhone: string;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly configService: ConfigService) {}

  async createPaymentLink(order: PaymentOrder) {
    const provider = this.configService.get<string>('payments.provider');

    if (provider === 'paystack') {
        return this.initiateDirectCharge(order);
    }

    const baseUrl = this.configService.get<string>('app.baseUrl');
    return `${baseUrl}/payments/mock/${order.id}`;
  }

  private async initiateDirectCharge(order: PaymentOrder) {
    const secretKey = this.configService.get<string>('payments.paystackSecretKey');
    const url = 'https://api.paystack.co/charge';
    
    const amount = Math.round(Number(order.total) * 100);
    const email = `${order.userPhone.replace('+', '')}@whatsapp-store.com`;
    const cleanPhone = order.userPhone.replace('+', '');
    
    // Detect provider (Focusing on Ghana/Nigeria common prefixes)
    const providerCode = this.detectProvider(cleanPhone);

    try {
        const response = await axios.post(
            url,
            {
                email,
                amount,
                reference: order.paymentRef,
                currency: "GHS", // Defaulting to GHS for STK Push, change to NGN if needed
                mobile_money: {
                    phone: cleanPhone,
                    provider: providerCode
                },
                metadata: {
                    orderId: order.id,
                    userPhone: order.userPhone
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${secretKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // For direct charge, we return a status message instead of a URL
        const status = response.data?.data?.status;
        if (status === 'send_birthday' || status === 'send_otp') {
            return "Please check your phone for a verification code.";
        }
        
        return "PROMPT_SENT";
    } catch (error: any) {
        this.logger.error('Failed to initiate direct charge', error?.response?.data || error.message);
        throw new Error('Payment initiation failed');
    }
  }

  private detectProvider(phone: string): string {
    // Basic detection for Ghana networks
    if (/^(233|0)(24|54|55|59|25|53)/.test(phone)) return 'mtn';
    if (/^(233|0)(20|50)/.test(phone)) return 'vod'; // Vodafone / Telecel
    if (/^(233|0)(26|56|27|57)/.test(phone)) return 'tgo'; // AirtelTigo / AT
    
    return 'mtn'; // Default to mtn
  }
}
