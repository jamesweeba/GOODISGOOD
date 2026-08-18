import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiService } from '../ai/ai.service';
import { AiReply } from '../ai/ai.types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { ProductsService } from '../products/products.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { RetentionService } from './retention.service';

type AssistantReplyState = 'confirm_order' | 'request_payment' | 'collect_name' | 'collect_address' | 'await_flow' | 'select_quantity';

type AssistantReply = {
  text: string;
  state?: {
    type: AssistantReplyState;
    payload?: Record<string, unknown>;
  };
  interactive?: {
    type: 'button' | 'list' | 'flow';
    data: any;
  };
};

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
    private readonly retentionService: RetentionService,
  ) { }

  async handleMessage(userPhone: string, message: string) {
    const trimmedMessage = message?.trim();
    if (!trimmedMessage) return;

    try {
      this.logger.log(`Inbound message from ${userPhone}: "${trimmedMessage}"`);

      // 1. Rate Limiting
      if (await this.isRateLimited(userPhone)) {
        this.logger.warn(`Rate limit triggered for ${userPhone}`);
        await this.whatsappService.sendMessage(userPhone, "You've sent too many messages. Please try again in a few minutes.");
        return;
      }

      // 2. State-based handling (Interactive button replies etc)
      const session = await this.prisma.userSession.findUnique({ where: { userPhone } });
      const currentState = session?.activeState as AssistantReplyState | null;
      this.logger.log(`Current session state for ${userPhone}: ${currentState ?? 'idle'}`);

      // Handle Direct/State transitions
      const directReply = await this.tryDirectOrStateCommand(userPhone, trimmedMessage, currentState);
      if (directReply) {
        this.logger.log(`Direct route matched for ${userPhone}: ${directReply.state?.type ?? 'message_only'}`);
        await this.sendReply(userPhone, trimmedMessage, directReply);
        return;
      }

      // Trigger background retention checks (Abandoned cart, New arrivals)
      this.retentionService.runRetentionChecks().catch(e => this.logger.error('Retention check failed', e));

      // 3. Smart Catalog Retrieval & AI Fallback
      const history = await this.prisma.chatHistory.findMany({
        where: { userPhone },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      // 1. Get Intent First (to decide if we search DB)
      const { intent, searchKeywords } = await this.aiService.classifyIntent(message);
      this.logger.log(`User Intent: ${intent} | Keywords: ${searchKeywords}`);

      let products: any[] = [];

      // 2. Conditional Database Search
      if (intent === 'browse' || intent === 'order' || (searchKeywords && searchKeywords.length > 0)) {
        products = await this.productsService.searchProducts(searchKeywords || message);
      }

      // 3. Generate Grounded Response
      const rawAiReply = await this.aiService.generateGroundedReply({
        message,
        intent,
        products,
        history: history.reverse()
      });

      this.logger.log(`AI raw response received for ${userPhone}`);
      const aiResponse = this.aiService.parseReply(rawAiReply);
      this.logger.log(`AI parsed response for ${userPhone}: intent=${aiResponse.intent}, action=${aiResponse.action}`);
      const reply = await this.handleAiAction(aiResponse, userPhone, currentState);
      this.logger.log(`Final reply state for ${userPhone}: ${reply.state?.type ?? 'none'}`);

      await this.sendReply(userPhone, message, reply);

    } catch (error: any) {
      this.logger.error(`Error handling message from ${userPhone}:`, error?.response?.data || error.message || error);
      await this.whatsappService.sendMessage(userPhone, "Sorry, I encountered an error. Please try again later.");
    }
  }

  private async isRateLimited(userPhone: string): Promise<boolean> {
    const limit = this.configService.get<number>('app.rateLimit', 20); // 20 msgs per hour
    const windowMs = 60 * 60 * 1000;
    const now = new Date();

    const rate = await this.prisma.rateLimit.upsert({
      where: { userPhone },
      create: { userPhone, count: 1, lastReset: now },
      update: {},
    });

    if (now.getTime() - rate.lastReset.getTime() > windowMs) {
      await this.prisma.rateLimit.update({
        where: { userPhone },
        data: { count: 1, lastReset: now },
      });
      return false;
    }

    if (rate.count >= limit) return true;

    await this.prisma.rateLimit.update({
      where: { userPhone },
      data: { count: { increment: 1 } },
    });
    return false;
  }

  private async tryDirectOrStateCommand(userPhone: string, message: string, state: AssistantReplyState | null): Promise<AssistantReply | null> {
    const normalized = message.toLowerCase();

    // Handle interactive button replies from WhatsApp (they often come as the button title or ID)
    if (state === 'confirm_order') {
      if (normalized === 'yes' || normalized === 'confirm_yes') {
        return {
          text: "Great! What is your full name?",
          state: { type: 'collect_name' }
        };
      }
      if (normalized === 'no' || normalized === 'confirm_no') {
        await this.ordersService.clearCart(userPhone);
        return { text: "Order cancelled. Your cart is now empty." };
      }
    }

    if (state === 'collect_name') {
      await this.ordersService.saveCustomerInfo(userPhone, message);
      return {
        text: `Thanks, ${message}! What is your shipping address?`,
        state: { type: 'collect_address' }
      };
    }

    if (state === 'collect_address') {
      await this.ordersService.saveShippingAddress(userPhone, message);
      const paymentMsg = await this.ordersService.getPaymentMessage(userPhone);
      this.notifyAdmin(userPhone, "New order ready for payment");
      return {
        text: `Perfect! We have everything we need.\n\n${paymentMsg}`,
        state: { type: 'request_payment' }
      };
    }

    // Basic direct commands
    if (normalized === 'cart' || normalized === 'view cart' || normalized === 'view_cart') {
      const cartSummary = await this.ordersService.viewCart(userPhone);
      if (cartSummary.includes('empty')) {
        return {
          text: cartSummary,
          interactive: {
            type: 'button',
            data: {
              body: cartSummary,
              buttons: [{ id: 'catalog', title: '🛒 Browse Catalog' }]
            }
          }
        };
      }
      return {
        text: cartSummary,
        interactive: {
          type: 'button',
          data: {
            body: `🛍️ *Your Current Cart*\n\n${cartSummary}\n\nWhat would you like to do?`,
            buttons: [
              { id: 'checkout', title: '💳 Checkout' },
              { id: 'catalog', title: '➕ Add More' },
              { id: 'clear_cart', title: '🗑️ Clear Cart' }
            ]
          }
        }
      };
    }

    if (normalized === 'clear_cart') {
      const reply = await this.ordersService.clearCart(userPhone);
      return {
        text: reply,
        interactive: {
          type: 'button',
          data: {
            body: "🗑️ Cart cleared successfully.",
            buttons: [{ id: 'catalog', title: '🛒 Start Over' }]
          }
        }
      };
    }

    if (normalized === 'hi' || normalized === 'hello') {
      const reorderOffer = await this.retentionService.offerReorderIfFrequent(userPhone);
      const body = reorderOffer
        ? `Welcome back! ${reorderOffer}\n\nHow can I help you today?`
        : "Hello! I'm your AI sales agent. Tap a button below to get started or just tell me what you're looking for.";

      const hasPastOrder = await this.prisma.order.findFirst({ where: { userPhone, status: 'paid' } });
      const buttons = [
        { id: 'catalog', title: '🛒 Catalog' },
        { id: 'view_cart', title: '🛍️ My Cart' }
      ];

      if (hasPastOrder) {
        buttons.push({ id: 'reorder', title: '🔄 Reorder Last Time' });
      } else {
        buttons.push({ id: 'order_status', title: '📦 Status' });
      }

      // 🖼️ Send the welcome banner image first (non-blocking)
      const welcomeImageUrl = this.configService.get<string>('app.welcomeImageUrl');
      if (welcomeImageUrl) {
        this.whatsappService.sendImage(
          userPhone,
          welcomeImageUrl,
          '🛍️ Marketix Groceries — Your Fresh Groceries, Delivered Fast!',
        ).catch(() => this.logger.warn('Could not send welcome banner image'));
      }

      return {
        text: body,
        interactive: {
          type: 'button',
          data: {
            body,
            buttons
          }
        }
      };
    }

    if (normalized === 'reorder') {
      const reply = await this.ordersService.reorderLastOrder(userPhone);
      return {
        text: reply,
        interactive: {
          type: 'button',
          data: {
            body: reply,
            buttons: [
              { id: 'checkout', title: '💳 Checkout' },
              { id: 'catalog', title: '🛒 Browse Catalog' }
            ]
          }
        }
      };
    }

    if (normalized === 'old_catalog' || normalized.startsWith('list_products')) {
      const products = await this.productsService.listAvailableProducts();

      if (products.length === 0) {
        return { text: "Our catalog is currently empty. Please check back later!" };
      }

      const catalogId = this.configService.get<string>('whatsapp.catalogId');
      if (catalogId && normalized === 'old_catalog') {
        // Group by category
        const categories = [...new Set(products.map(p => p.category || 'General'))];
        const sections = categories.slice(0, 10).map(cat => ({
          title: cat,
          product_retailer_ids: products
            .filter(p => (p.category || 'General') === cat)
            .slice(0, 30)
            .map(p => p.id)
        }));

        return {
          text: "🛒 Browse our digital shop! Tap below to see our products grouped by category.",
          interactive: {
            type: 'button',
            data: {
              body: "Welcome to our digital shop! Browse our fresh arrivals and add items directly to your cart.",
              buttons: [{ id: 'list_products', title: '📜 View Text List' }]
            }
          }
        };
      }

      // Handle Pagination
      const page = normalized.includes(':') ? parseInt(normalized.split(':')[1], 10) : 0;
      const pageSize = 7;
      const start = page * pageSize;
      const end = start + pageSize;
      const paginated = products.slice(start, end);
      const hasNext = products.length > end;

      const bodyText = `We have *${products.length} items* available today! \n\n_Showing page ${page + 1} of ${Math.ceil(products.length / pageSize)}._ \n\n_Tip: Select an item to add it to your cart. The catalog will stay open so you can add more!_`;

      const rows = paginated.map(p => ({
        id: `add_${p.id}`,
        title: p.name.slice(0, 24),
        description: `GHS ${Number(p.price).toFixed(2)}`
      }));

      const navigationRows = [];
      if (hasNext) {
        navigationRows.push({ id: `list_products:${page + 1}`, title: '➡️ Next Page', description: 'See more products' });
      }
      if (page > 0) {
        navigationRows.push({ id: `list_products:${page - 1}`, title: '⬅️ Previous Page', description: 'Go back' });
      }

      navigationRows.push({ id: 'view_cart', title: '🛍️ View Cart', description: 'See what you added' });
      navigationRows.push({ id: 'checkout', title: '💳 Checkout', description: 'Finish order' });

      return {
        text: bodyText,
        interactive: {
          type: 'list',
          data: {
            button: 'View Products',
            sections: [
              {
                title: 'Available Products',
                rows: rows
              },
              {
                title: 'Navigation & Cart',
                rows: navigationRows.slice(0, 10 - rows.length)
              }
            ]
          }
        }
      };
    }

    if (normalized === 'flow_buy' || normalized === 'shop' || normalized === 'catalog' || normalized === 'list' || normalized === 'products') {
      const flowId = this.configService.get<string>('whatsapp.flowId');
      const dbProducts = (await this.productsService.listAvailableProducts()).slice(0, 10);

      // Only use Flow if a flowId is configured
      const flowMode = this.configService.get<string>('whatsapp.flowMode') ?? 'draft';
      const useFlow = !!flowId;
      if (useFlow) {
        const allProducts = await this.productsService.listAvailableProducts();
        const PAGE_SIZE = 5;
        const totalPages = Math.max(1, Math.ceil(allProducts.length / PAGE_SIZE));
        const pageProducts = allProducts.slice(0, PAGE_SIZE);

        const pageOptions = Array.from({ length: totalPages }, (_, i) => ({
          id: String(i + 1),
          title: `Page ${i + 1}`,
        }));

        const flowData = {
          banner_url: this.configService.get<string>('app.welcomeImageUrl') ?? '',
          products: pageProducts.map((p) => {
            const rawName = p.name as string;
            const match = rawName.match(/^(.*?)\s*\(([^)]+)\)$/);
            let parsedTitle = rawName;
            let unit = '';
            if (match) {
              parsedTitle = match[1].trim();
              unit = match[2].trim();
            } else if (p.category && p.category !== 'General') {
              unit = p.category;
            }

            const title = parsedTitle.length > 30
              ? parsedTitle.substring(0, 27) + '…'
              : parsedTitle;
            const price = `₵${Number(p.price).toFixed(2)}`;
            const description = unit ? `${price} · ${unit}` : price;
            return { id: p.id, title, description };
          }),
          pre_selected: [] as string[],
          page_label: `Page 1 of ${totalPages} · ${allProducts.length} products`,
          selection_note: '0 items selected so far',
          search_prefill: '',
          page_options: pageOptions,
          page_prefill: '1',
          notice: '',
          show_notice: false
        };

        return {
          text: "Browse our products below and choose your quantities 🛒",
          interactive: {
            type: 'flow',
            data: {
              flowId,
              buttonText: '🛒 Order Now',
              flowToken: `buy-${Date.now()}`,
              screenId: 'PRODUCT_SELECT',
              data: flowData,
            }
          }
        };
      }

      // Fallback: interactive list (works without a published flow)
      if (dbProducts.length === 0) {
        return { text: "Our catalog is currently empty. Please check back later!" };
      }

      const pageSize = 9;
      const rows = dbProducts.slice(0, pageSize).map(p => ({
        id: `add_${p.id}`,
        title: p.name.slice(0, 24),
        description: `₵${Number(p.price).toFixed(2)}`
      }));

      rows.push({ id: 'view_cart', title: '🛍️ View Cart', description: 'See your current cart' });

      const bodyText = `We have *${dbProducts.length}+ items* available!\n\nTap a product to add it to your cart 👇`;
      return {
        text: bodyText,
        interactive: {
          type: 'list',
          data: {
            button: '🛒 Browse Products',
            sections: [
              { title: '🥬 Available Products', rows }
            ]
          }
        }
      };
    }


    if (normalized === 'full_catalog') {
      const products = await this.productsService.listAvailableProducts();
      const listText = products.map(p => `• *${p.name}*: GHS ${Number(p.price).toFixed(2)}`).join('\n');
      return {
        text: `📜 *Complete Price List*\n\n${listText}\n\n_To order, just type the name of the item!_`,
        interactive: {
          type: 'button',
          data: {
            body: `I've sent the full list of ${products.length} items above. Ready to order?`,
            buttons: [{ id: 'catalog', title: '🛒 Open Selector' }]
          }
        }
      };
    }

    if (normalized.startsWith('add_')) {
      const productId = normalized.replace('add_', '');
      const products = await this.productsService.listAvailableProducts();
      const product = products.find(p => p.id === productId);

      if (product) {
        const bodyText = `🛒 *${product.name}*\nPrice: GHS ${Number(product.price).toFixed(2)}\n\nHow many would you like to add to your cart?`;

        return {
          text: bodyText,
          state: { type: 'select_quantity', payload: { productId: product.id, productName: product.name } },
          interactive: {
            type: 'button',
            data: {
              body: bodyText,
              buttons: [
                { id: `qty_${product.id}_1`, title: '1' },
                { id: `qty_${product.id}_3`, title: '3' },
                { id: `qty_${product.id}_5`, title: '5' }
              ]
            }
          }
        };
      }
    }

    if (state === 'select_quantity' && normalized.startsWith('qty_')) {
      const parts = normalized.split('_');
      const productId = parts[1];
      const quantity = parseInt(parts[2], 10);

      const products = await this.productsService.listAvailableProducts();
      const product = products.find(p => p.id === productId);

      if (product && !isNaN(quantity)) {
        await this.ordersService.addItemsToCart(userPhone, [{ name: product.name, quantity }]);
        const cart = await this.ordersService.viewCart(userPhone);
        const totalItems = (cart.match(/•/g) || []).length;

        const bodyText = `✅ Added *${quantity}x ${product.name}* to your cart!\n\nYou now have *${totalItems} items*. What would you like to do next?`;

        return {
          text: bodyText,
          interactive: {
            type: 'button',
            data: {
              body: bodyText,
              buttons: [
                { id: 'list_products', title: '🛒 Keep Shopping' },
                { id: 'view_cart', title: '🛍️ View Cart' },
                { id: 'checkout', title: '💳 Checkout' }
              ]
            }
          }
        };
      }
    }

    if (normalized === 'checkout') {
      const order = await this.ordersService.getPending(userPhone);
      if (!order || order.items.length === 0) return { text: "Your cart is empty! Browse our products to add items." };
      return this.handleAiAction({ action: 'collect_customer_info', reply: '', intent: 'order', products: [] }, userPhone, state);
    }

    if (normalized === 'order_status') {
      return { text: await this.ordersService.getTrackingInfo(userPhone) };
    }

    if (normalized.includes('reorder') || normalized.includes('repeat last')) {
      const reply = await this.ordersService.reorderLastOrder(userPhone);
      return {
        text: reply,
        interactive: {
          type: 'button',
          data: {
            body: reply,
            buttons: [
              { id: 'checkout', title: '💳 Checkout Now' },
              { id: 'view_cart', title: '🛒 View Cart' }
            ]
          }
        }
      };
    }

    return null;
  }

  private async handleAiAction(ai: AiReply, userPhone: string, currentState: AssistantReplyState | null): Promise<AssistantReply> {
    if (ai.action === 'confirm_order' && ai.products.length > 0) {
      const summary = ai.products.map(p => `${p.name} x ${p.quantity}`).join(', ');
      return {
        text: `You want to add: ${summary}. Is this correct?`,
        state: { type: 'confirm_order', payload: { products: ai.products } },
        interactive: {
          type: 'button',
          data: {
            body: `Confirm adding ${summary} to your cart?`,
            buttons: [
              { id: 'confirm_yes', title: 'Yes, confirm' },
              { id: 'confirm_no', title: 'No, cancel' }
            ]
          }
        }
      };
    }

    if (ai.action === 'collect_customer_info') {
      /* Disabling Flow for checkout until verification is approved
      const flowId = this.configService.get<string>('whatsapp.flowId');
      if (flowId) {
        return {
          text: "I'll need some details to complete your order. Please fill out this short form.",
          state: { type: 'await_flow' },
          interactive: {
            type: 'flow',
            data: {
                flowId,
                buttonText: 'Enter Details',
                flowToken: `order-${Date.now()}`
            }
          }
        };
      }
      */

      return {
        text: "I'll need some details to complete your order. What is your full name?",
        state: { type: 'collect_name' }
      };
    }

    if (ai.intent === 'view_cart') {
      return { text: await this.ordersService.viewCart(userPhone) };
    }

    if (ai.intent === 'provide_name' && currentState === 'collect_name') {
      await this.ordersService.saveCustomerInfo(userPhone, ai.reply); // Assuming AI extracts name
      return { text: "Got it! Now, what is your shipping address?", state: { type: 'collect_address' } };
    }

    if (ai.intent === 'reorder') {
      return { text: await this.ordersService.reorderLastOrder(userPhone) };
    }

    return { text: ai.reply };
  }

  private async sendReply(userPhone: string, userMsg: string, reply: AssistantReply) {
    this.logger.log(`Sending reply to ${userPhone}: "${reply.text}"`);

    // 1. Save History
    await this.prisma.chatHistory.createMany({
      data: [
        { userPhone, message: userMsg, role: 'user' },
        { userPhone, message: reply.text, role: 'assistant' }
      ]
    });

    // 2. Update Session
    await this.prisma.userSession.upsert({
      where: { userPhone },
      create: { userPhone, activeState: reply.state?.type ?? null, statePayload: (reply.state?.payload as any) ?? {} },
      update: { activeState: reply.state?.type ?? null, statePayload: (reply.state?.payload as any) ?? {} }
    });

    // 3. Send via WhatsApp
    if (reply.interactive?.type === 'button') {
      this.logger.log(`Sending interactive button message to ${userPhone}`);
      await this.whatsappService.sendInteractiveButtons(
        userPhone,
        reply.interactive.data.body,
        reply.interactive.data.buttons
      );
    } else if (reply.interactive?.type === 'list') {
      this.logger.log(`Sending interactive list message to ${userPhone}`);
      await this.whatsappService.sendInteractiveList(
        userPhone,
        reply.text,
        reply.interactive.data.button,
        reply.interactive.data.sections
      );
    } else if (reply.interactive?.type === 'flow') {
      this.logger.log(`Sending flow message to ${userPhone}`);
      await this.whatsappService.sendFlow(
        userPhone,
        reply.text,
        reply.interactive.data.buttonText,
        reply.interactive.data.flowId,
        reply.interactive.data.flowToken,
        reply.interactive.data.flowAction ?? 'navigate',
        reply.interactive.data.screenId ?? 'DETAILS',
        reply.interactive.data.data ?? {}
      );
    } else if (reply.text.includes('Browse our digital shop') && this.configService.get<string>('whatsapp.catalogId')) {
      this.logger.log(`Sending product catalog message to ${userPhone}`);
      const products = await this.productsService.listAvailableProducts();
      const categories = [...new Set(products.map(p => p.category || 'General'))];
      const sections = categories.slice(0, 10).map(cat => ({
        title: cat,
        product_retailer_ids: products
          .filter(p => (p.category || 'General') === cat)
          .slice(0, 30)
          .map(p => p.id)
      }));

      await this.whatsappService.sendMultiProductMessage(
        userPhone,
        reply.text,
        this.configService.get<string>('whatsapp.catalogId')!,
        sections
      );
    } else {
      this.logger.log(`Sending plain text message to ${userPhone}`);
      await this.whatsappService.sendMessage(userPhone, reply.text);
    }

    // 4. Send Product Images if mentioned and available
    if (reply.text.includes('selected') || reply.text.includes('found')) {
      const products = await this.productsService.listAvailableProducts();
      for (const p of products) {
        if (reply.text.toLowerCase().includes(p.name.toLowerCase()) && p.imageUrl) {
          await this.whatsappService.sendImage(userPhone, p.imageUrl, p.name);
        }
      }
    }
  }

  private notifyAdmin(userPhone: string, message: string) {
    const adminPhone = this.configService.get<string>('app.adminPhone');
    this.logger.log(`ADMIN ALERT [${userPhone}]: ${message}`);
    if (adminPhone) {
      this.whatsappService.sendMessage(adminPhone, `🚨 *Admin Alert* from ${userPhone}\n${message}`).catch(() => { });
    }
  }

  async handleFlowResponse(userPhone: string, data: any) {
    this.logger.log(`Received flow response from ${userPhone}: ${JSON.stringify(data)}`);

    // Handle Multi-Screen Flow Payload (cart_json string)
    if (data.cart) {
      const products = await this.productsService.listAvailableProducts();
      const itemsToAdd: { name: string; quantity: number }[] = [];
      let cartArray = [];
      try {
        cartArray = JSON.parse(data.cart);
      } catch (e) {
        this.logger.error('Failed to parse cart json from flow', e);
      }

      for (const item of cartArray) {
        const product = products.find(p => p.id === item.id);
        if (product && item.qty > 0) {
          itemsToAdd.push({ name: product.name, quantity: item.qty });
        }
      }

      if (itemsToAdd.length > 0) {
        await this.ordersService.addItemsToCart(userPhone, itemsToAdd);

        if (data.fulfillment) {
          let addressMsg = `Fulfillment: ${data.fulfillment === 'delivery' ? '🚚 Delivery' : '🏪 Pickup'}`;
          if (data.address) {
            addressMsg += `\n📍 Address/Landmark: ${data.address}`;
            await this.ordersService.saveShippingAddress(userPhone, data.address);
          }
          
          const checkoutSummary = await this.ordersService.getPaymentMessage(userPhone);
          await this.sendReply(userPhone, `[Flow: Order Confirmed]`, {
            text: `✅ *Order Placed!*\n${addressMsg}\n\n${checkoutSummary}`
          });
        } else {
          const cartSummary = await this.ordersService.viewCart(userPhone);
          await this.sendReply(userPhone, `[Flow: Added ${itemsToAdd.length} items]`, {
            text: `🛒 *Your Cart Summary*\n\n${cartSummary}`,
            interactive: {
              type: 'button',
              data: {
                body: "Would you like to add more or proceed to checkout?",
                buttons: [
                  { id: 'shop', title: '➕ Add More' },
                  { id: 'checkout', title: '💳 Checkout' }
                ]
              }
            }
          });
        }
      } else {
        await this.sendReply(userPhone, '[Flow: no items selected]', {
          text: "You didn't select any items. Tap below to try again!",
          interactive: {
            type: 'button',
            data: {
              body: "No items were selected.",
              buttons: [{ id: 'shop', title: '🛒 Open Shop' }]
            }
          }
        });
      }
      return;
    }

    // Handle Product Order Flow (flat p0_id/p0_qty … p9_id/p9_qty format)
    const hasFlatSlots = Object.keys(data).some(k => /^p\d_id$/.test(k));
    if (hasFlatSlots) {
      const products = await this.productsService.listAvailableProducts();
      const itemsToAdd: { name: string; quantity: number }[] = [];
      const addedNames: string[] = [];

      for (let i = 0; i < 10; i++) {
        const productId = data[`p${i}_id`];
        const qty = parseInt(data[`p${i}_qty`] ?? '0', 10);
        if (!productId || productId === 'empty' || qty <= 0) continue;

        const product = products.find(p => p.id === productId);
        if (product) {
          itemsToAdd.push({ name: product.name, quantity: qty });
          addedNames.push(`${product.name} (x${qty})`);
        }
      }

      if (itemsToAdd.length > 0) {
        await this.ordersService.addItemsToCart(userPhone, itemsToAdd);
        const cartSummary = await this.ordersService.viewCart(userPhone);
        await this.sendReply(userPhone, `[Flow: Added ${itemsToAdd.length} items]`, {
          text: `🛒 *Your Cart Summary*\n\n${cartSummary}`,
          interactive: {
            type: 'button',
            data: {
              body: "Would you like to add more or proceed to checkout?",
              buttons: [
                { id: 'shop', title: '➕ Add More' },
                { id: 'checkout', title: '💳 Checkout' }
              ]
            }
          }
        });
      } else {
        await this.sendReply(userPhone, '[Flow: no items selected]', {
          text: "You didn't select any items. Tap below to try again!",
          interactive: {
            type: 'button',
            data: {
              body: "No items were selected.",
              buttons: [{ id: 'shop', title: '🛒 Open Shop' }]
            }
          }
        });
      }
      return;
    }

    // Handle Customer Info Flow (existing)
    if (data.full_name && data.shipping_address) {
      await this.ordersService.saveCustomerFlowData(userPhone, {
        full_name: data.full_name,
        shipping_address: data.shipping_address
      });

      const paymentMsg = await this.ordersService.getPaymentMessage(userPhone);
      if (paymentMsg) {
        await this.sendReply(userPhone, "[Flow Submitted]", {
          text: `Perfect! We have everything we need.\n\n${paymentMsg}`,
          state: { type: 'request_payment' }
        });
        this.notifyAdmin(userPhone, "New order ready for payment (via Flow)");
      }
    }
  }

  async handleCatalogOrder(userPhone: string, orderData: any) {
    this.logger.log(`Processing catalog order for ${userPhone}`);

    const products = await this.productsService.listAvailableProducts();
    const itemsToAdd: { name: string; quantity: number }[] = [];
    const addedNames: string[] = [];

    for (const item of orderData.product_items) {
      const product = products.find(p => p.id === item.product_retailer_id);
      if (product) {
        const quantity = parseInt(item.quantity, 10);
        itemsToAdd.push({ name: product.name, quantity });
        addedNames.push(`${product.name} (x${quantity})`);
      }
    }

    if (itemsToAdd.length > 0) {
      // Use true to replace the existing cart with the catalog's selection
      await this.ordersService.createOrderMulti(userPhone, itemsToAdd);
      const cartSummary = await this.ordersService.viewCart(userPhone);

      await this.sendReply(userPhone, `[Catalog Order: ${itemsToAdd.length} items]`, {
        text: `🛒 *Cart Updated from Catalog!*\n\nItems added:\n• ${addedNames.join('\n• ')}\n\n${cartSummary}`,
        interactive: {
          type: 'button',
          data: {
            body: "Would you like to add more or proceed to checkout?",
            buttons: [
              { id: 'catalog', title: '🔄 Re-open Shop' },
              { id: 'checkout', title: '💳 Checkout Now' }
            ]
          }
        }
      });
    }
  }
}
