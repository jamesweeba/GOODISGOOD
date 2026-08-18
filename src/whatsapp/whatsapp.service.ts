import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly configService: ConfigService) { }

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

  async sendImage(to: string, imageUrl: string, caption?: string) {
    const response = await this.postToMessagesEndpoint({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "image",
      image: {
        link: imageUrl,
        caption,
      },
    });

    return response.data;
  }

  async sendInteractiveButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
    header?: string,
    footer?: string,
  ) {
    const response = await this.postToMessagesEndpoint({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        header: header ? { type: "text", text: header } : undefined,
        body: { text: body },
        footer: footer ? { text: footer } : undefined,
        action: {
          buttons: buttons.map((btn) => ({
            type: "reply",
            reply: { id: btn.id, title: btn.title },
          })),
        },
      },
    });

    return response.data;
  }

  async sendFlow(
    to: string,
    body: string,
    buttonText: string,
    flowId: string,
    flowToken: string,
    flowAction: 'navigate' | 'data_exchange' = 'navigate',
    screenId: string = 'DETAILS',
    data: Record<string, any> = {},
  ) {
    console.log("flowid", flowId);
    console.log("flowToken", flowToken);
    console.log("flowAction", flowAction);
    console.log("screenId", screenId);
    console.log("data", data);


    const flowMode = 'draft';
    const welcomeImageUrl = this.configService.get<string>('app.welcomeImageUrl');

    const response = await this.postToMessagesEndpoint({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "flow",
        ...(welcomeImageUrl
          ? {
              header: {
                type: "image",
                image: { link: welcomeImageUrl },
              },
            }
          : {}),
        body: { text: body },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: flowToken,
            flow_id: flowId,
            flow_cta: buttonText,
            flow_action: flowAction,
            mode: flowMode,
            flow_action_payload: {
              screen: screenId,
              ...(Object.keys(data).length > 0 ? { data } : {})
            }
          }
        }
      }
    });

    return response.data;
  }

  async sendInteractiveList(
    to: string,
    body: string,
    buttonTitle: string,
    sections: Array<{
      title?: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>,
    header?: string,
    footer?: string,
  ) {
    const response = await this.postToMessagesEndpoint({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        header: header ? { type: "text", text: header } : undefined,
        body: { text: body },
        footer: footer ? { text: footer } : undefined,
        action: {
          button: buttonTitle,
          sections: sections.map((section) => ({
            title: section.title,
            rows: section.rows.map((row) => ({
              id: row.id,
              title: row.title,
              description: row.description,
            })),
          })),
        },
      },
    });

    return response.data;
  }

  async sendMultiProductMessage(
    to: string,
    body: string,
    catalogId: string,
    sections: Array<{ title: string; product_retailer_ids: string[] }>,
    header?: string,
    footer?: string,
  ) {
    const response = await this.postToMessagesEndpoint({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "product_list",
        header: header ? { type: "text", text: header } : undefined,
        body: { text: body },
        footer: footer ? { text: footer } : undefined,
        action: {
          catalog_id: catalogId,
          sections: sections
        }
      }
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

    this.logger.log(`SENDING TO WHATSAPP: ${JSON.stringify(payload, null, 2)}`);

    try {
      const https = require('https');
      const agent = new https.Agent({ family: 4 });
      
      return await axios.post(
        `https://graph.facebook.com/${apiVersion}/${phoneId}/messages`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          httpsAgent: agent,
          timeout: 10000,
        },
      );
    } catch (error: any) {
      if (error.response) {
        this.logger.error(`WhatsApp API Error Response: ${JSON.stringify(error.response.data)}`);
      } else {
        this.logger.error(`WhatsApp API Error: ${error.message || error.code}`);
      }
      throw error;
    }
  }
}
