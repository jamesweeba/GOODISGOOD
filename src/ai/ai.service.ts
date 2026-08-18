import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { ChatHistory, Product } from "@prisma/client";
import { AiReply } from "./ai.types";

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly configService: ConfigService) {}

  async classifyIntent(message: string): Promise<{ intent: string, searchKeywords?: string }> {
    const prompt = `Analyze the following user message for a WhatsApp commerce bot. 
    Identify the intent and extract 2-3 search keywords if they are looking for products.
    
    Intents: browse, order, status, help, other
    
    Message: "${message}"
    
    Return ONLY JSON: { "intent": "intent_here", "searchKeywords": "keywords_here" }`;

    const response = await this.callAiProvider(prompt);
    try {
        return JSON.parse(response);
    } catch {
        return { intent: 'other' };
    }
  }

  async generateGroundedReply(params: {
    message: string;
    intent: string;
    products: Product[];
    history: ChatHistory[];
  }) {
    const productContext = params.products.length > 0 
        ? params.products.map(p => `${p.name} - $${Number(p.price).toFixed(2)} (${p.description})`).join('\n')
        : "No matching products found in our database.";

    const prompt = `You are a helpful sales assistant. 
    
    CATALOG FROM DATABASE:
    ${productContext}
    
    STRICT RULE: You can ONLY sell or discuss products listed above. If a customer asks for something else, politely say we don't have it.
    
    User Intent: ${params.intent}
    User Message: "${params.message}"
    
    Return ONLY JSON:
    {
      "reply": "string",
      "intent": "${params.intent}",
      "products": [{"name": "string", "quantity": 1}],
      "action": "none | confirm_order | collect_customer_info | request_payment"
    }`;

    return await this.callAiProvider(prompt);
  }

  private async callAiProvider(prompt: string): Promise<string> {
    const provider = this.configService.get<string>("ai.provider");
    if (provider === "openrouter") return await this.generateWithOpenRouterFree(prompt);
    if (provider === "anthropic") return await this.callAnthropic(prompt);
    return await this.callOpenAi(prompt);
  }


  async generateWithOpenRouterFree(prompt: string): Promise<string> {
    const apiKey = this.configService.get<string>("ai.openRouterApiKey");

    const model =
      this.configService.get<string>("ai.openRouterModel") ??
      process.env.OPENROUTER_MODEL ??
      "meta-llama/llama-3-8b-instruct";

    const url = "https://openrouter.ai/api/v1/chat/completions";

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "WhatsAppSalesAgent",
    };

    const payload = {
      model,
      max_tokens: 600,
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
          timeout: 15000,
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

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new Error("Unexpected failure");
  }

  parseReply(raw: string): AiReply {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : raw;
      const parsed = JSON.parse(jsonStr) as Partial<AiReply>;
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
        (product, index) => `${index + 1}. ${product.name} - $${Number(product.price).toFixed(2)}${product.description ? ` (${product.description})` : ''}`,
      )
      .join("\n");

    const historyLines = params.history
      .map((entry) => `${entry.role}: ${entry.message}`)
      .join("\n");

    return `
You are a professional WhatsApp sales assistant for an online store.

Catalog (showing most relevant items):
${productLines || "No items matched your query specifically, but we have many products in stock."}

Recent conversation:
${historyLines || "No prior messages"}

Current message: "${params.message}"

Return ONLY valid JSON with this shape:
{
  "reply": "string",
  "intent": "browse | order | confirm | question | view_cart | update_cart | remove_from_cart | provide_name | provide_address | reorder",
  "products": [{"name": "string", "quantity": 1}],
  "action": "none | confirm_order | collect_customer_info | request_payment"
}

Behavior rules:
1. If the user wants to buy/add items (e.g. "I want 1 and 3" or "2, 4"), use intent "order".
2. The catalog is indexed. If the user mentions a number, it refers to the item at that position in the catalog list provided below.
3. If the user says "reorder", repeat their previous order.
4. If the user confirms an order (e.g. says "yes"), use intent "confirm" and action "confirm_order".
5. After order confirmation, collect name and address if missing.
6. Use ONLY product names from the catalog.
7. Return JSON only.
`.trim();
  }

  private async callOpenAi(prompt: string): Promise<string> {
    try {
      const apiKey = this.configService.get<string>("ai.openaiApiKey");
      const model = this.configService.get<string>("ai.openaiModel") || "gpt-4-mini";

      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 600,
        },
        {
          timeout: 15000,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      return response.data?.choices?.[0]?.message?.content || JSON.stringify(this.safeFallbackReply());
    } catch (error: any) {
      this.logger.error(`OpenAI request failed: ${error.message}`);
      return JSON.stringify(this.safeFallbackReply());
    }
  }

  private async callAnthropic(prompt: string) {
    const apiKey = this.configService.get<string>("ai.anthropicApiKey");
    const model = this.configService.get<string>("ai.anthropicModel") || "claude-3-haiku-20240307";

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model,
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      {
        timeout: 15000,
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
      reply: "I am having a bit of trouble processing that. Could you please rephrase it?",
      intent: "question",
      products: [],
      action: "none",
    };
  }

}
