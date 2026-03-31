import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiService } from '../ai/ai.service';
import { AiReply } from '../ai/ai.types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { ProductsService } from '../products/products.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

type AssistantReplyState = 'confirm_order' | 'request_payment';

type AssistantReply = {
  text: string;
  state?: {
    type: AssistantReplyState;
    payload?: Record<string, unknown>;
  };
};

type SessionState = {
  type: AssistantReplyState;
  payload: Record<string, unknown>;
} | null;

const DEFAULT_CHAT_PHRASES = {
  greeting: [
    'hi',
    'hello',
    'hey',
    'yo',
    'good morning',
    'good afternoon',
    'good evening',
    'hola',
  ],
  affirmative: [
    'yes',
    'yep',
    'yeah',
    'yup',
    'ok',
    'okay',
    'sure',
    'alright',
    'affirmative',
    'go ahead',
    'sounds good',
  ],
  negative: ['no', 'nope', 'nah', 'negative', 'not now'],
  maybe: ['maybe', 'perhaps', 'not sure', 'unsure'],
  productList: [
    'products',
    'list products',
    'menu',
    'show me what you have',
    'in stock',
    'available',
    'have in stock',
    'what do you have',
    'what do you sell',
    'show products',
    'show me products',
  ],
  payment: [
    'pay',
    'payment',
    'make payment',
    'pay now',
    'checkout',
    'check out',
    'send payment',
    'complete payment',
    'finish payment',
  ],
  cartView: ['cart', 'view cart'],
  cartClear: ['clear cart', 'clear my cart', 'empty cart', 'remove all'],
  purchase: ['want', 'buy', 'get', 'take', 'need', 'order', 'add', 'both'],
  removal: ['remove', 'delete', 'take out', 'take off', 'drop', 'minus', 'subtract'],
} as const;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly productsService: ProductsService,
    private readonly whatsappService: WhatsAppService,
    private readonly ordersService: OrdersService,
    private readonly configService: ConfigService,
  ) {}

  async handleMessage(userPhone: string, message: string) {
    const trimmedMessage = message?.trim();
    if (!trimmedMessage) {
      return;
    }

    try {
      void this.ordersService.maybeExpireOldCarts().catch((error) => {
        this.logger.warn(`Cart expiration sweep failed: ${String(error)}`);
      });

      const directReply = await this.tryDirectCommand(userPhone, trimmedMessage);
      if (directReply) {
        await this.updateUserSession(userPhone, directReply.state ?? null);

        await Promise.all([
          this.prisma.chatHistory.create({
            data: {
              userPhone,
              message: trimmedMessage,
              role: 'user',
            },
          }),
          this.prisma.chatHistory.create({
            data: {
              userPhone,
              message: directReply.text,
              role: 'assistant',
            },
          }),
          this.whatsappService.sendMessage(userPhone, directReply.text),
        ]);
        return;
      }

      await this.prisma.chatHistory.create({
        data: {
          userPhone,
          message: trimmedMessage,
          role: 'user',
        },
      });

      const [products, history] = await Promise.all([
        this.productsService.listAvailableProducts(),
        this.prisma.chatHistory.findMany({
          where: { userPhone },
          orderBy: { createdAt: 'desc' },
          take: 6,
        }),
      ]);

      const rawResponse = await this.aiService.generateReply({
        message: trimmedMessage,
        products,
        history: history.reverse(),
      });
      const aiResponse = this.aiService.parseReply(rawResponse);
      const reply = await this.handleAction(aiResponse, userPhone);

      await this.updateUserSession(userPhone, reply.state ?? null);

      await Promise.all([
        this.prisma.chatHistory.create({
          data: {
            userPhone,
            message: reply.text,
            role: 'assistant',
          },
        }),
        this.whatsappService.sendMessage(userPhone, reply.text),
      ]);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : 'Unexpected error';

      this.logger.error('Failed to handle incoming message', error);
      await this.whatsappService.sendMessage(
        userPhone,
        `Sorry, something went wrong: ${messageText}`,
      );
    }
  }

  private async handleAction(ai: AiReply, userPhone: string): Promise<AssistantReply> {
    if (ai.action === 'confirm_order' && ai.products.length > 0) {
      return {
        text: `You selected ${ai.products
          .map((product) => `${product.name} x ${product.quantity}`)
          .join(', ')}. Reply YES to create the order or NO to cancel.`,
        state: {
          type: 'confirm_order',
          payload: {
            products: ai.products,
          },
        },
      };
    }

    if (ai.action === 'create_order' && ai.products.length > 0) {
      const order = await this.ordersService.createOrderMulti(userPhone, ai.products);
      return {
        text: `Order created. Total: $${Number(order.total).toFixed(
          2,
        )}. Reply YES when you are ready to pay.`,
        state: {
          type: 'request_payment',
        },
      };
    }

    if (ai.action === 'request_payment') {
      const paymentMessage = await this.ordersService.getPaymentMessage(userPhone);
      if (!paymentMessage) {
        return {
          text: 'There is no active order to pay for yet. Add items to your cart first.',
        };
      }

      return {
        text: paymentMessage,
        state: {
          type: 'request_payment',
        },
      };
    }

    if (ai.intent === 'view_cart') {
      return {
        text: await this.ordersService.viewCart(userPhone),
      };
    }

    if (ai.intent === 'update_cart' && ai.products.length > 0) {
      return {
        text: await this.ordersService.updateCart(userPhone, ai.products),
      };
    }

    if (ai.intent === 'remove_from_cart' && ai.products.length > 0) {
      return {
        text: await this.ordersService.removeItemsFromCart(userPhone, ai.products),
      };
    }

    return {
      text: ai.reply || 'I did not understand that. Please rephrase it.',
    };
  }

  private async tryDirectCommand(userPhone: string, message: string) {
    const normalized = message.trim().toLowerCase();

    if (this.isGreeting(normalized)) {
      const products = await this.productsService.listAvailableProducts();
      const featuredProducts = products.slice(0, 3).map((product) => product.name);
      const productHint =
        featuredProducts.length > 0
          ? ` We currently have ${featuredProducts.join(', ')}.`
          : '';

      return {
        text: `Hello! Welcome to our store.${productHint} What would you like to buy today?`,
      };
    }

    if (this.isCartViewRequest(normalized)) {
      return {
        text: await this.ordersService.viewCart(userPhone),
      };
    }

    if (
      this.matchesExactPhrase(
        normalized,
        this.getConfiguredPhrases(
          'chat.phrases.cartClear',
          DEFAULT_CHAT_PHRASES.cartClear,
        ),
      )
    ) {
      return {
        text: await this.ordersService.clearCart(userPhone),
      };
    }

    if (this.isProductListRequest(normalized)) {
      return {
        text: await this.formatAvailableProducts(),
      };
    }

    const productInquiryReply = await this.tryProductInquiryCommand(normalized);
    if (productInquiryReply) {
      return productInquiryReply;
    }

    const conditionalAvailabilityReply = await this.tryConditionalAvailabilityCommand(
      normalized,
    );
    if (conditionalAvailabilityReply) {
      return conditionalAvailabilityReply;
    }

    const removeReply = await this.tryRemoveFromCartCommand(userPhone, normalized);
    if (removeReply) {
      return removeReply;
    }

    const quantityReply = await this.tryQuantityBasedCartCommand(userPhone, normalized);
    if (quantityReply) {
      return quantityReply;
    }

    const productSelectionReply = await this.tryProductSelectionCommand(
      userPhone,
      normalized,
    );
    if (productSelectionReply) {
      return productSelectionReply;
    }

    if (this.isAffirmativeReply(normalized)) {
      return this.resolveYesReply(userPhone);
    }

    if (this.isNegativeReply(normalized)) {
      return this.resolveNoReply(userPhone);
    }

    if (this.isMaybeReply(normalized)) {
      return this.resolveMaybeReply(userPhone);
    }

    const paymentReply = await this.tryPaymentCommand(userPhone, normalized);
    if (paymentReply) {
      return paymentReply;
    }

    return null;
  }

  private isGreeting(message: string) {
    return this.matchesAnyPhrase(
      message,
      this.getConfiguredPhrases('chat.phrases.greeting', DEFAULT_CHAT_PHRASES.greeting),
    );
  }

  private isAffirmativeReply(message: string) {
    return this.matchesAnyPhrase(
      message,
      this.getConfiguredPhrases(
        'chat.phrases.affirmative',
        DEFAULT_CHAT_PHRASES.affirmative,
      ),
    );
  }

  private isNegativeReply(message: string) {
    return this.matchesAnyPhrase(
      message,
      this.getConfiguredPhrases('chat.phrases.negative', DEFAULT_CHAT_PHRASES.negative),
    );
  }

  private isMaybeReply(message: string) {
    return this.matchesAnyPhrase(
      message,
      this.getConfiguredPhrases('chat.phrases.maybe', DEFAULT_CHAT_PHRASES.maybe),
    );
  }

  private async tryProductSelectionCommand(
    userPhone: string,
    message: string,
  ) {
    const products = await this.productsService.listAvailableProducts();
    const matchedProducts = products.filter((product) =>
      this.messageReferencesProduct(message, product.name),
    );

    if (!matchedProducts.length) {
      return null;
    }

    const soundsLikePurchase = this.matchesAnyPhrase(
      message,
      this.getConfiguredPhrases('chat.phrases.purchase', DEFAULT_CHAT_PHRASES.purchase),
    );

    if (!soundsLikePurchase) {
      return null;
    }

    const cartText = await this.ordersService.addItemsToCart(
      userPhone,
      matchedProducts.map((product) => ({
        name: product.name,
        quantity: 1,
      })),
    );

    return {
      text: `Added to your cart.\n${cartText}`,
    };
  }

  private async tryQuantityBasedCartCommand(
    userPhone: string,
    message: string,
  ) {
    const hasQuantitySignal =
      /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(message);
    const soundsLikePurchase = this.matchesAnyPhrase(
      message,
      this.getConfiguredPhrases('chat.phrases.purchase', DEFAULT_CHAT_PHRASES.purchase),
    );

    if (!hasQuantitySignal && !soundsLikePurchase) {
      return null;
    }

    const products = await this.productsService.listAvailableProducts();
    const matchedProducts = this.parseQuantityProductPairs(message, products);

    if (!matchedProducts.length) {
      return null;
    }

    const cartText = await this.ordersService.addItemsToCart(
      userPhone,
      matchedProducts.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
      })),
    );

    return {
      text: `Added to your cart.\n${cartText}`,
    };
  }

  private async tryProductInquiryCommand(message: string) {
    if (!this.isProductInquiryRequest(message)) {
      return null;
    }

    const products = await this.productsService.listAvailableProducts();
    const matchedProducts = products.filter((product) =>
      this.messageReferencesProduct(message, product.name),
    );

    if (matchedProducts.length > 0) {
      return {
        text: this.formatProductDetails(matchedProducts, products),
      };
    }

    return {
      text: this.formatUnavailableProductResponse(message, products),
    };
  }

  private async tryConditionalAvailabilityCommand(message: string) {
    if (!this.isConditionalAvailabilityRequest(message)) {
      return null;
    }

    const products = await this.productsService.listAvailableProducts();
    const matchedProducts = products.filter((product) =>
      this.messageReferencesProduct(message, product.name),
    );

    if (matchedProducts.length > 0) {
      return {
        text: this.formatAvailabilityConfirmationResponse(matchedProducts, products),
      };
    }

    return {
      text: this.formatUnavailableProductResponse(message, products),
    };
  }

  private async tryPaymentCommand(userPhone: string, message: string) {
    const soundsLikePayment = this.matchesAnyPhrase(
      message,
      this.getConfiguredPhrases('chat.phrases.payment', DEFAULT_CHAT_PHRASES.payment),
    );

    if (!soundsLikePayment) {
      return null;
    }

    const paymentMessage = await this.ordersService.getPaymentMessage(userPhone);
    if (!paymentMessage) {
      return {
        text: 'There is no active order to pay for yet. Add items to your cart first.',
      };
    }

    return {
      text: paymentMessage,
      state: {
        type: 'request_payment',
      },
    };
  }

  private async tryRemoveFromCartCommand(userPhone: string, message: string) {
    const soundsLikeRemoval = this.matchesAnyPhrase(
      message,
      this.getConfiguredPhrases('chat.phrases.removal', DEFAULT_CHAT_PHRASES.removal),
    );

    if (!soundsLikeRemoval) {
      return null;
    }

    const products = await this.productsService.listAvailableProducts();
    const matchedProducts = this.parseQuantityProductPairs(message, products);

    if (!matchedProducts.length) {
      return null;
    }

    const cartText = await this.ordersService.removeItemsFromCart(
      userPhone,
      matchedProducts.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
      })),
    );

    return {
      text: `Removed from your cart.\n${cartText}`,
    };
  }

  private parseQuantityProductPairs(
    message: string,
    products: Array<{ name: string }>,
  ) {
    const normalized = message
      .toLowerCase()
      .replace(/[.,!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

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

    return products
      .map((product) => {
        const aliases = this.productSearchTerms(product.name);
        for (const alias of aliases) {
          const regex = new RegExp(
            `(?:\\b(?<qty>\\d+|one|two|three|four|five|six|seven|eight|nine|ten)\\b\\s+)?(?:\\b(?:and|plus)\\b\\s*)?(?:the\\s+)?\\b${this.escapeRegex(alias)}\\b`,
            'i',
          );

          const match = normalized.match(regex);
          if (!match?.groups) {
            continue;
          }

          const rawQty = match.groups.qty?.toLowerCase();
          const quantity = rawQty ? numberWords[rawQty] ?? Number(rawQty) : 1;

          if (!Number.isFinite(quantity) || quantity <= 0) {
            continue;
          }

          return {
            product,
            quantity: Math.trunc(quantity),
          };
        }

        return null;
      })
      .filter(
        (item): item is { product: { name: string }; quantity: number } =>
          Boolean(item),
      );
  }

  private productSearchTerms(productName: string) {
    const normalized = productName.toLowerCase();
    const parts = normalized
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 4);

    const suffix = normalized.split(/\s+/).slice(-1)[0];
    if (suffix && suffix.length >= 4 && !parts.includes(suffix)) {
      parts.push(suffix);
      parts.push(this.pluralizeTerm(suffix));
    }

    parts.push(this.pluralizeTerm(normalized));

    return Array.from(new Set(parts));
  }

  private messageReferencesProduct(message: string, productName: string) {
    const normalizedProductName = productName.toLowerCase();

    if (message.includes(normalizedProductName)) {
      return true;
    }

    const aliases = this.productSearchTerms(productName);
    return aliases.some((alias) => new RegExp(`\\b${this.escapeRegex(alias)}\\b`, 'i').test(message));
  }

  private isProductListRequest(message: string) {
    return this.matchesAnyPhrase(
      message,
      this.getConfiguredPhrases(
        'chat.phrases.productList',
        DEFAULT_CHAT_PHRASES.productList,
      ),
    );
  }

  private isCartViewRequest(message: string) {
    const configuredPhrases = this.getConfiguredPhrases(
      'chat.phrases.cartView',
      DEFAULT_CHAT_PHRASES.cartView,
    );

    if (this.matchesExactPhrase(message, configuredPhrases)) {
      return true;
    }

    return (
      /\b(?:show|show me|list|display|what(?:'s| is)?|what is)\b.*\b(?:my\s+)?(?:cart|car)\b/i.test(
        message,
      ) ||
      /\bitems?\s+in\s+my\s+(?:cart|car)\b/i.test(message) ||
      /\b(?:what(?:'s| is)?|show me|show|list|display)\s+.*\b(?:in|inside)\s+my\s+(?:cart|car)\b/i.test(
        message,
      )
    );
  }

  private matchesAnyPhrase(message: string, phrases: string[]) {
    return phrases.some((phrase) => this.messageContainsPhrase(message, phrase));
  }

  private matchesExactPhrase(message: string, phrases: string[]) {
    const normalizedMessage = message.trim().toLowerCase();
    return phrases.some((phrase) => phrase.trim().toLowerCase() === normalizedMessage);
  }

  private getConfiguredPhrases(key: string, fallback: readonly string[]) {
    const configured = this.configService.get<unknown>(key);

    if (Array.isArray(configured)) {
      return this.normalizePhraseList(configured);
    }

    if (typeof configured === 'string') {
      return this.normalizePhraseList(configured.split(','));
    }

    if (key === 'chat.phrases.productList') {
      const legacyConfigured = this.configService.get<unknown>('chat.productListPhrases');

      if (Array.isArray(legacyConfigured)) {
        return this.normalizePhraseList(legacyConfigured);
      }

      if (typeof legacyConfigured === 'string') {
        return this.normalizePhraseList(legacyConfigured.split(','));
      }
    }

    return Array.from(fallback);
  }

  private normalizePhraseList(phrases: unknown[]) {
    return phrases
      .map((phrase) => String(phrase).trim().toLowerCase())
      .filter((phrase) => phrase.length > 0);
  }

  private messageContainsPhrase(message: string, phrase: string) {
    const normalizedPhrase = phrase.trim().toLowerCase();
    if (!normalizedPhrase) {
      return false;
    }

    const pattern = new RegExp(
      `(?:^|\\b)${this.escapeRegex(normalizedPhrase)}(?:\\b|$)`,
      'i',
    );

    return pattern.test(message);
  }

  private isProductInquiryRequest(message: string) {
    return (
      /\b(do you have|have you got|is there|are there|available|tell me about|what is|what's|price of|cost of|details on)\b/i.test(
        message,
      ) ||
      /\b(is|are)\s+.*\s+available\b/i.test(message)
    );
  }

  private isConditionalAvailabilityRequest(message: string) {
    return (
      /\bif you have\b/i.test(message) ||
      /\bif available\b/i.test(message) ||
      /\bif (?:it|that|they|there)\s+(?:is|are|was|were)\s+available\b/i.test(message)
    );
  }

  private async formatAvailableProducts() {
    const products = await this.productsService.listAvailableProducts();
    if (!products.length) {
      return 'No products are available right now.';
    }

    return [
      'We have the following products in stock:',
      ...products.map(
        (product) =>
          `${product.name} - $${Number(product.price).toFixed(2)}${product.description ? ` - ${product.description}` : ''}`,
      ),
    ].join('\n');
  }

  private formatProductDetails(
    products: Array<{
      name: string;
      price: unknown;
      description?: string | null;
    }>,
    catalog: Array<{
      name: string;
      price: unknown;
      description?: string | null;
    }> = products,
  ) {
    const lines = products.map((product) => {
      const description = product.description?.trim();
      return [
        `${product.name} - $${Number(product.price).toFixed(2)}`,
        description ? `Description: ${description}` : 'Description: Not available',
      ].join('\n');
    });

    const bestMatch = this.pickBestInquiryMatch(products, catalog);
    const suggestion = bestMatch
      ? `Best match: ${bestMatch.name} if you want the most relevant option first.`
      : null;

    return [
      products.length > 1 ? 'Here are the matching products:' : 'Here is what I found:',
      ...lines,
      suggestion ?? '',
      '',
      'Would you like me to add it to your cart?',
    ].join('\n');
  }

  private formatUnavailableProductResponse(
    message: string,
    catalog: Array<{
      name: string;
      price: unknown;
      description?: string | null;
    }>,
  ) {
    const requestedProduct = this.extractRequestedProductName(message);
    const availableProducts = catalog.slice(0, 3);

    const availableNames = availableProducts.map((product) => product.name);
    const suggestedNames =
      availableNames.length > 0
        ? availableNames.length === 1
          ? availableNames[0]
          : availableNames.length === 2
            ? `${availableNames[0]} and ${availableNames[1]}`
            : `${availableNames.slice(0, -1).join(', ')}, and ${availableNames[availableNames.length - 1]}`
        : null;

    const productLine =
      requestedProduct && requestedProduct !== 'that'
        ? suggestedNames
          ? `Sorry, we do not have ${requestedProduct} right now, but we do have ${suggestedNames}.`
          : `Sorry, we do not have ${requestedProduct} right now.`
        : suggestedNames
          ? `Sorry, that item is not in stock right now, but we do have ${suggestedNames}.`
          : 'Sorry, that item is not in stock right now.';

    if (!availableProducts.length) {
      return `${productLine} We do not have any other products available at the moment.`;
    }

    return productLine;
  }

  private formatAvailabilityConfirmationResponse(
    products: Array<{
      name: string;
      price: unknown;
      description?: string | null;
    }>,
    catalog: Array<{
      name: string;
      price: unknown;
      description?: string | null;
    }>,
  ) {
    void catalog;

    return products.length > 1
      ? `Yes, we have ${products.map((product) => product.name).join(', ')}. Want me to add them to your cart?`
      : `Yes, we have ${products[0].name}. Want me to add them to your cart?`;
  }

  private pickBestInquiryMatch(
    matches: Array<{ name: string }>,
    catalog: Array<{ name: string; description?: string | null }>,
  ) {
    if (matches.length === 0) {
      return null;
    }

    const lowerCatalog = catalog.map((item) => ({
      ...item,
      searchable: `${item.name} ${item.description ?? ''}`.toLowerCase(),
    }));

    return (
      matches.find((match) => {
        const query = match.name.toLowerCase();
        return lowerCatalog.some((item) => item.searchable.includes(query));
      }) ?? matches[0]
    );
  }

  private async resolveYesReply(userPhone: string): Promise<AssistantReply> {
    const state = await this.getUserSessionState(userPhone);

    if (!state) {
      return {
        text: 'Sure. What would you like to buy or confirm?',
      };
    }

    if (state.type === 'confirm_order') {
      const products = this.parseProductsFromPayload(state.payload?.products);
      if (!products.length) {
        return {
          text: 'I need the items again before I can confirm that order.',
        };
      }

      const order = await this.ordersService.createOrderMulti(userPhone, products);
      const paymentMessage = await this.ordersService.getPaymentMessage(userPhone);

      return {
        text:
          paymentMessage ??
          `Order created. Total: $${Number(order.total).toFixed(2)}. Please try again if payment does not appear.`,
        state: {
          type: 'request_payment',
        },
      };
    }

    if (state.type === 'request_payment') {
      const paymentMessage = await this.ordersService.getPaymentMessage(userPhone);
      return {
        text: paymentMessage ?? 'There is no active order waiting for payment.',
        state: {
          type: 'request_payment',
        },
      };
    }

    return {
      text: 'Sure. What would you like to buy or confirm?',
    };
  }

  private async resolveNoReply(userPhone: string): Promise<AssistantReply> {
    const state = await this.getUserSessionState(userPhone);

    if (!state) {
      return {
        text: 'No problem. What would you like to do next?',
      };
    }

    if (state.type === 'confirm_order') {
      const cancelled = await this.ordersService.cancelPending(userPhone);
      return {
        text: cancelled
          ? 'Your active order has been cancelled.'
          : 'There is no active order to cancel.',
      };
    }

    if (state.type === 'request_payment') {
      return {
        text: 'No problem. Your order is still saved if you want to pay later.',
      };
    }

    return {
      text: 'No problem. What would you like to do next?',
    };
  }

  private async resolveMaybeReply(userPhone: string): Promise<AssistantReply> {
    const state = await this.getUserSessionState(userPhone);

    if (!state) {
      return {
        text: 'No worries. What would you like to buy or ask about?',
      };
    }

    if (state.type === 'confirm_order') {
      return {
        text: 'No worries. I will keep the items in your cart for now.',
      };
    }

    if (state.type === 'request_payment') {
      return {
        text: 'No problem. Your order remains saved if you want to pay later.',
      };
    }

    return {
      text: 'No worries. What would you like to buy or ask about?',
    };
  }

  private parseProductsFromPayload(payload: unknown) {
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload
      .filter((item): item is { name: string; quantity: number } => {
        return (
          !!item &&
          typeof item === 'object' &&
          typeof (item as { name?: unknown }).name === 'string' &&
          typeof (item as { quantity?: unknown }).quantity === 'number'
        );
      })
      .map((item) => ({
        name: item.name,
        quantity: item.quantity,
      }));
  }

  private async getUserSessionState(userPhone: string): Promise<SessionState> {
    const session = await this.prisma.userSession.findUnique({
      where: { userPhone },
    });

    if (!session?.activeState) {
      return null;
    }

    return {
      type: session.activeState as AssistantReplyState,
      payload: (session.statePayload as Record<string, unknown> | null) ?? {},
    };
  }

  private async updateUserSession(
    userPhone: string,
    state: AssistantReply['state'] | null,
  ) {
    const statePayload = state?.payload
      ? (state.payload as Prisma.InputJsonValue)
      : Prisma.DbNull;

    await this.prisma.userSession.upsert({
      where: { userPhone },
      create: {
        userPhone,
        activeState: state?.type ?? null,
        statePayload,
      },
      update: {
        activeState: state?.type ?? null,
        statePayload,
      },
    });
  }

  private escapeRegex(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private extractRequestedProductName(message: string) {
    const normalized = message
      .toLowerCase()
      .replace(/[.,!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const requestPatterns = [
      /\bif you have\s+(?<item>.+?)(?:\s+(?:add|put|buy|order|to cart|in cart|cart)|$)/i,
      /\bif available\s+(?<item>.+?)(?:\s+(?:add|put|buy|order|to cart|in cart|cart)|$)/i,
      /\b(?:do you have|have you got|is there|are there|available|tell me about|what is|what's|price of|cost of|details on)\s+(?<item>.+?)(?:\s+in stock|\s+available|\?|$)/i,
      /\b(?:is|are)\s+(?<item>.+?)\s+available\b/i,
    ];

    for (const pattern of requestPatterns) {
      const match = normalized.match(pattern);
      const item = match?.groups?.item?.trim();
      if (item) {
        return item;
      }
    }

    return null;
  }

  private pluralizeTerm(term: string) {
    if (term.endsWith('s')) {
      return term;
    }

    if (/(ch|sh|x|z)$/.test(term)) {
      return `${term}es`;
    }

    if (/[^aeiou]y$/.test(term)) {
      return `${term.slice(0, -1)}ies`;
    }

    return `${term}s`;
  }
}
