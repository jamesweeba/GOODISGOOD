import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendMessage(to: string, body: string) {
    const response = await this.postToMessagesEndpoint({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body,
      },
    });

    return response.data;
  }

  async sendTypingIndicator(messageId: string) {
    const payload = {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      typing_indicator: {
        type: "text",
      },
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.postToMessagesEndpoint(payload);
        return true;
      } catch (error) {
        const isLastAttempt = attempt === 2;
        if (!isLastAttempt) {
          await new Promise((resolve) => setTimeout(resolve, 350));
          continue;
        }

        this.logger.warn(`Failed to send typing indicator for ${messageId}`);
        await this.markAsRead(messageId);
        return false;
      }
    }
  }

  async markAsRead(messageId: string) {
    const response = await this.postToMessagesEndpoint({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });

    return response.data;
  }

  private async postToMessagesEndpoint(payload: Record<string, unknown>) {
    const token = this.configService.get<string>("whatsapp.token");
    const phoneId = this.configService.get<string>("whatsapp.phoneId");
    const apiVersion = this.configService.get<string>("whatsapp.apiVersion");

    try {
      return await axios.post(
        `https://graph.facebook.com/${apiVersion}/${phoneId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );
    } catch (error) {
      this.logger.error("Failed to call WhatsApp messages endpoint", error);
      throw error;
    }
  }
}
