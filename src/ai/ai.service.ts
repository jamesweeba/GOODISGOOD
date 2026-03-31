import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { ChatHistory, Product } from "@prisma/client";
import { AiReply } from "./ai.types";

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly configService: ConfigService) {}

  async generateReply(params: {
    message: string;
    products: Product[];
    history: ChatHistory[];
  }) {
    const prompt = this.buildPrompt(params);
    const provider = this.configService.get<string>("ai.provider");

    try {
      if (provider === "anthropic") {
        return await this.callAnthropic(prompt);
      }

      if (provider === "openrouter") {
        return await this.generateWithOpenRouterFree(prompt);
      }

      return await this.callOpenAi(prompt);
    } catch (error) {
      this.logger.error("AI provider call failed", error);
      return JSON.stringify(this.buildFallbackReply(params));
    }
  }

  async generateWithOpenRouterFree(prompt: string): Promise<string> {
    const apiKey = this.configService.get<string>("ai.openRouterApiKey");

    const model =
      this.configService.get<string>("ai.openRouterModel") ??
      "meta-llama/llama-3-8b-instruct"; // ✅ free + stable

    const url = "https://openrouter.ai/api/v1/chat/completions";

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000", // change in production
      "X-Title": "MyApp", // change to your app name
    };

    const payload = {
      model,
      max_tokens: 180,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(url, payload, {
          headers,
          timeout: 12000,
        });

        const content = response?.data?.choices?.[0]?.message?.content;

        if (!content) {
          throw new Error("Empty response from OpenRouter");
        }

        return this.extractMessageText(content);
      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;

        console.error(
          `OpenRouter attempt ${attempt + 1} failed:`,
          error?.response?.data || error.message,
        );

        if (isLastAttempt) {
          throw new Error("AI request failed after retries");
        }

        // small delay before retry (helps with network instability)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new Error("Unexpected failure"); // fallback safety
  }

  parseReply(raw: string): AiReply {
    try {
      const parsed = JSON.parse(raw) as Partial<AiReply>;
      return {
        reply:
          parsed.reply ??
          "I could not understand your request. Please rephrase it.",
        intent: parsed.intent ?? "question",
        products: Array.isArray(parsed.products) ? parsed.products : [],
        action: parsed.action ?? "none",
      };
    } catch {
      return this.safeFallbackReply();
    }
  }

  private buildPrompt(params: {
    message: string;
    products: Product[];
    history: ChatHistory[];
  }) {
    const productLines = params.products
      .map(
        (product) => `${product.name} - $${Number(product.price).toFixed(2)}`,
      )
      .join("\n");

    const historyLines = params.history
      .map((entry) => `${entry.role}: ${entry.message}`)
      .join("\n");

    return `
You are a WhatsApp sales assistant for one online store.

Catalog:
${productLines}

Recent conversation:
${historyLines || "No prior messages"}

Return ONLY valid JSON with this shape:
{
  "reply": "string",
  "intent": "browse | order | confirm | question | view_cart | update_cart | remove_from_cart",
  "products": [{"name": "string", "quantity": 1}],
  "action": "none | confirm_order | create_order | request_payment"
}

Intent guide:
- browse: the user wants to see the catalog or what is available.
- order: the user wants to buy or add products but has not confirmed yet.
- confirm: the user is confirming a proposed order or cart selection.
- question: the user asks about a specific product, price, stock, or details.
- view_cart: the user asks to see the cart.
- update_cart: the user wants to change quantity or edit cart items.
- remove_from_cart: the user explicitly wants to remove items from the cart.

Behavior rules:
- Use only product names from the catalog.
- Never invent products.
- If the user asks for all products or what is available, use intent "browse".
- If the user asks about a specific item, use intent "question".
- If the user wants to add items, include the matching products and quantity.
- Ask for quantity when the user wants to order but did not specify one.
- Use "view_cart" only for cart-view requests.
- Use "update_cart" only for quantity changes, additions, or cart edits.
- Use "remove_from_cart" only for explicit removal requests.
- Use "request_payment" only after a clear confirmation to pay.
- Keep the JSON minimal and the reply concise.

Examples:
User: what do you have
Intent: browse

User: do you have iphone?
Intent: question

User: add 2 canvas tote
Intent: order

User: yes, go ahead
Intent: confirm

User: show my cart
Expected output:
\`\`\`json
{
  "reply": "Here is your cart.",
  "intent": "view_cart",
  "products": [],
  "action": "none"
}
\`\`\`

User: change canvas tote to 3
Expected output:
\`\`\`json
{
  "reply": "I will update your cart.",
  "intent": "update_cart",
  "products": [{"name": "Canvas Tote", "quantity": 3}],
  "action": "none"
}
\`\`\`

User: remove canvas tote
Expected output:
\`\`\`json
{
  "reply": "I will remove that item from your cart.",
  "intent": "remove_from_cart",
  "products": [{"name": "Canvas Tote", "quantity": 1}],
  "action": "none"
}
\`\`\`

User:
${params.message}
`.trim();
  }

  private async callOpenAi(prompt: string): Promise<string> {
    try {
      const apiKey = this.configService.get<string>("ai.openaiApiKey");
      const model =
        this.configService.get<string>("ai.openaiModel") || "gpt-4.1-mini";

      const response = await axios.post(
        "https://api.openai.com/v1/responses",
        {
          model,
          input: prompt,
          max_output_tokens: 180,
        },
        {
          timeout: 12000,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      const outputs = response.data?.output || [];
      let finalText = "";

      for (const item of outputs) {
        if (item.type === "message") {
          for (const content of item.content) {
            if (content.type === "output_text") {
              finalText += content.text;
            }
          }
        }
      }

      return finalText.trim().length > 0
        ? finalText.trim()
        : JSON.stringify(this.safeFallbackReply());
    } catch (error: any) {
      this.logger.error(
        `OpenAI request failed: ${JSON.stringify(error?.response?.data ?? error?.message ?? error)}`,
      );
      return JSON.stringify(this.safeFallbackReply());
    }
  }

  private async callAnthropic(prompt: string) {
    const apiKey = this.configService.get<string>("ai.anthropicApiKey");
    const model = this.configService.get<string>("ai.anthropicModel");

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model,
        max_tokens: 180,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      {
        timeout: 12000,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
      },
    );

    return this.extractMessageText(response.data?.content?.[0]?.text);
  }

  private extractMessageText(content: unknown) {
    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
        .trim();

      if (text.length > 0) {
        return text;
      }
    }

    return JSON.stringify(this.safeFallbackReply());
  }

  private safeFallbackReply(): AiReply {
    return {
      reply: "I could not understand your request. Please rephrase it.",
      intent: "question",
      products: [],
      action: "none",
    };
  }

  private buildFallbackReply(params: {
    message: string;
    products: Product[];
    history: ChatHistory[];
  }): AiReply {
    const message = params.message.trim().toLowerCase();
    const matchedProducts = params.products.filter((product) =>
      this.messageReferencesProduct(message, product.name),
    );

    if (this.isPaymentRequest(message)) {
      return {
        reply:
          "I am having trouble reaching the AI right now, but I can still help with payment.",
        intent: "question",
        products: [],
        action: "request_payment",
      };
    }

    if (this.isCartViewRequest(message)) {
      return {
        reply: "I am having trouble reaching the AI right now, but I can show your cart.",
        intent: "view_cart",
        products: [],
        action: "none",
      };
    }

    if (this.isRemovalRequest(message) && matchedProducts.length > 0) {
      return {
        reply: "I am having trouble reaching the AI right now, but I can remove items from your cart.",
        intent: "remove_from_cart",
        products: matchedProducts.map((product) => ({
          name: product.name,
          quantity: this.extractFallbackQuantity(message),
        })),
        action: "none",
      };
    }

    if (this.isUpdateRequest(message) && matchedProducts.length > 0) {
      return {
        reply: "I am having trouble reaching the AI right now, but I can update your cart.",
        intent: "update_cart",
        products: matchedProducts.map((product) => ({
          name: product.name,
          quantity: this.extractFallbackQuantity(message),
        })),
        action: "none",
      };
    }

    if (matchedProducts.length > 0) {
      return {
        reply: "I found the product you mentioned, but I could not reach the AI service.",
        intent: "question",
        products: matchedProducts.map((product) => ({
          name: product.name,
          quantity: 1,
        })),
        action: "none",
      };
    }

    if (this.isProductInquiryRequest(message)) {
      return {
        reply: this.formatUnavailableProductResponse(params.products),
        intent: "question",
        products: [],
        action: "none",
      };
    }

    return this.safeFallbackReply();
  }

  private isPaymentRequest(message: string) {
    return /\b(pay|payment|make payment|pay now|checkout|check out|send payment|complete payment|finish payment)\b/i.test(
      message,
    );
  }

  private isCartViewRequest(message: string) {
    return /\b(cart|view cart|show cart|my cart|what is in my cart|check cart)\b/i.test(
      message,
    );
  }

  private isRemovalRequest(message: string) {
    return /\b(remove|delete|take out|take off|drop|minus|subtract)\b/i.test(message);
  }

  private isUpdateRequest(message: string) {
    return /\b(add|buy|get|take|need|order|increase|change|update)\b/i.test(message);
  }

  private extractFallbackQuantity(message: string) {
    const numberWords: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };

    const match = message.match(
      /\b(?<qty>\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i,
    );
    const rawQty = match?.groups?.qty?.toLowerCase();
    const quantity = rawQty ? numberWords[rawQty] ?? Number(rawQty) : 1;

    return Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : 1;
  }

  private messageReferencesProduct(message: string, productName: string) {
    const normalizedProductName = productName.toLowerCase();

    if (message.includes(normalizedProductName)) {
      return true;
    }

    const escaped = normalizedProductName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}s?\\b`, 'i').test(message);
  }

  private isProductInquiryRequest(message: string) {
    return (
      /\b(do you have|have you got|is there|are there|available|tell me about|what is|what's|price of|cost of|details on)\b/i.test(
        message,
      ) ||
      /\b(is|are)\s+.*\s+available\b/i.test(message)
    );
  }

  private formatUnavailableProductResponse(products: Product[]) {
    if (!products.length) {
      return 'Sorry, that item is not in stock right now. We do not have any other products available at the moment.';
    }

    return [
      'Sorry, that item is not in stock right now.',
      'Here is what we currently have:',
      ...products.slice(0, 3).map(
        (product) =>
          `${product.name} - $${Number(product.price).toFixed(2)}${product.description ? ` - ${product.description}` : ''}`,
      ),
    ].join('\n');
  }
}
