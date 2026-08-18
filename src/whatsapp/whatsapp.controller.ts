import * as crypto from 'crypto';
import { Body, Controller, Get, Header, Headers, HttpCode, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { Request } from 'express';
import { ChatService } from '../chat/chat.service';
import { ConfigService } from '@nestjs/config';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { WhatsAppService } from './whatsapp.service';
import { ProductsService } from '../products/products.service';
import { WhatsAppFlowService } from './whatsapp-flow.service';
import { Product } from '@prisma/client';

type WhatsAppMessage = {
  id?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  text?: {
    body?: string;
  };
  order?: {
      catalog_id: string;
      text?: string;
      product_items: Array<{
          product_retailer_id: string;
          quantity: string;
          item_price: string;
          currency: string;
      }>;
  };
};

type WhatsAppWebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppMessage[];
      };
    }>;
  }>;
};


// ─── Flow session state ─────────────────────────────────────────────────────

interface FlowSession {
  query: string;           // current search query
  category: string;        // active category filter ('all' = no filter)
  page: number;            // current page (1-based)
  selected: Set<string>;   // globally accumulated product ids
  lastDisplayedIds: string[]; // ids shown on the last PRODUCT_SELECT render
}

// ─── Controller ─────────────────────────────────────────────────────────────

@Controller('webhook')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);
  private readonly PAGE_SIZE = 7;
  private flowSessions = new Map<string, FlowSession>();

  constructor(
    private readonly chatService: ChatService,
    private readonly configService: ConfigService,
    private readonly webhookService: WhatsAppWebhookService,
    private readonly whatsappService: WhatsAppService,
    private readonly productsService: ProductsService,
    private readonly whatsappFlowService: WhatsAppFlowService,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Returns an existing session or creates a fresh one. */
  private getSession(flowToken: string): FlowSession {
    if (!this.flowSessions.has(flowToken)) {
      this.flowSessions.set(flowToken, {
        query: '',
        category: 'all',
        page: 1,
        selected: new Set(),
        lastDisplayedIds: [],
      });
    }
    return this.flowSessions.get(flowToken)!;
  }

  /**
   * Merges `selectedOnPage` into the session's global selection set.
   * For every product displayed on the previous page:
   *   – remove it if the user un-ticked it (absent from selectedOnPage)
   *   – keep/add it if it is present in selectedOnPage
   */
  private mergeSelection(session: FlowSession, selectedOnPage: string[]): void {
    for (const id of session.lastDisplayedIds) {
      if (selectedOnPage.includes(id)) {
        session.selected.add(id);
      } else {
        session.selected.delete(id);
      }
    }
    // Also add anything newly ticked that wasn't in lastDisplayedIds
    for (const id of selectedOnPage) {
      session.selected.add(id);
    }
  }

  /**
   * Single source of truth for PRODUCT_SELECT responses.
   * ALWAYS returns every one of the 9 required data keys.
   */
  /**
   * Runs schema validation assertion on PRODUCT_SELECT responses.
   * Logs error and offending JSON on failure.
   */
  private runSchemaGuard(responseData: any) {
    if (responseData.screen !== 'PRODUCT_SELECT') return;
    const data = responseData.data;
    const requiredKeys = [
      'products',
      'pre_selected',
      'page_label',
      'selection_note',
      'search_prefill',
      'page_options',
      'page_prefill',
      'notice',
      'show_notice',
    ];

    try {
      for (const key of requiredKeys) {
        if (data[key] === undefined) {
          throw new Error(`Key "${key}" is missing from PRODUCT_SELECT data`);
        }
      }
      if (!Array.isArray(data.products)) {
        throw new Error(`"products" is not an array`);
      }
      if (data.products.length > this.PAGE_SIZE) {
        throw new Error(`"products" has length ${data.products.length}, expected <= ${this.PAGE_SIZE}`);
      }
      for (let i = 0; i < data.products.length; i++) {
        const p = data.products[i];
        if (typeof p.id !== 'string') throw new Error(`Product [${i}].id is not a string`);
        if (typeof p.title !== 'string') throw new Error(`Product [${i}].title is not a string`);
        if (typeof p.description !== 'string') throw new Error(`Product [${i}].description is not a string`);
      }
      if (typeof data.show_notice !== 'boolean') {
        throw new Error(`"show_notice" is not a boolean`);
      }
      if (!Array.isArray(data.pre_selected)) {
        throw new Error(`"pre_selected" is not an array`);
      }
      if (typeof data.page_prefill !== 'string') {
        throw new Error(`"page_prefill" is not a string`);
      }
      if (!Array.isArray(data.page_options)) {
        throw new Error(`"page_options" is not an array`);
      }
      for (let i = 0; i < data.page_options.length; i++) {
        const opt = data.page_options[i];
        if (typeof opt.id !== 'string') throw new Error(`page_options [${i}].id is not a string`);
        if (typeof opt.title !== 'string') throw new Error(`page_options [${i}].title is not a string`);
      }
    } catch (err: any) {
      this.logger.error(`SCHEMA GUARD FAILED: ${err.message}\nOffending JSON:\n${JSON.stringify(responseData, null, 2)}`);
      throw err;
    }
  }

  /**
   * Single source of truth for PRODUCT_SELECT responses.
   * ALWAYS returns every one of the 9 required data keys.
   */
  private async buildProductSelectScreen(
    session: FlowSession,
    version: string,
    notice = '',
  ): Promise<any> {
    // 1. Fetch the relevant product list (category > search > all)
    let allProducts: Product[];
    if (session.query) {
      allProducts = (await this.productsService.searchProducts(session.query)) as Product[];
      if (allProducts.length === 0) {
        notice = `We couldn't find '${session.query}', but here are some recommended alternatives!`;
        allProducts = (await this.productsService.listAvailableProducts()) as Product[];
      }
    } else if (session.category && session.category !== 'all') {
      allProducts = (await this.productsService.listByCategory(session.category)) as Product[];
      if (allProducts.length === 0) {
        notice = `No products found in '${session.category}'. Here are some recommendations!`;
        allProducts = (await this.productsService.listAvailableProducts()) as Product[];
      }
    } else {
      allProducts = (await this.productsService.listAvailableProducts()) as Product[];
    }

    // 1b. Fetch all categories for the dropdown
    const rawCategories = await this.productsService.listCategories();
    const categories = [
      { id: 'all', title: 'All' },
      ...rawCategories.map((c) => ({ id: c.toLowerCase(), title: c })),
    ];
    const categoryPrefill = session.category || 'all';

    // 2. Pagination
    const totalPages = Math.max(1, Math.ceil(allProducts.length / this.PAGE_SIZE));
    const safePage = Math.min(Math.max(Number(session.page) || 1, 1), totalPages);
    session.page = safePage; // clamp in session too

    const startIndex = (safePage - 1) * this.PAGE_SIZE;
    const pageProducts = allProducts.slice(startIndex, startIndex + this.PAGE_SIZE);

    // 3. Track which ids are on this page (for next merge)
    session.lastDisplayedIds = pageProducts.map((p) => String(p.id ?? ""));

    // 4. Page options – always at least 1 entry, and keys must be strings
    const pageOptions = Array.from({ length: totalPages }, (_, i) => ({
      id: String(i + 1),
      title: `Page ${i + 1}`,
    }));

    // 5. pre_selected: intersection of session.selected and current page ids
    const preSelected = pageProducts
      .map((p) => String(p.id ?? ""))
      .filter((id) => session.selected.has(id));

    // 6. Build product tiles — title ≤ 30 chars, description = "₵price · category"
    const products = pageProducts.map((p) => {
      const id = String(p.id ?? "");
      const rawName = String(p.name ?? "").trim();
      
      const match = rawName.match(/^(.*?)\s*\(([^)]+)\)$/);
      let parsedTitle = rawName;
      let unit = '';
      if (match) {
        parsedTitle = match[1].trim();
        unit = match[2].trim();
      } else if (p.category && p.category !== 'General') {
        unit = String(p.category).trim();
      }

      let title = parsedTitle.length > 30
        ? parsedTitle.substring(0, 27) + '…'
        : parsedTitle;
      if (!title) {
        title = "Product";
        this.logger.warn(`Defensive fallback: Product ${id} has an empty title.`);
      }

      let priceStr = "";
      if (p.price != null && !isNaN(Number(p.price))) {
        priceStr = `₵${Number(p.price).toFixed(2)}`;
      } else {
        this.logger.warn(`Defensive fallback: Product ${id} has a missing or invalid price.`);
      }

      const description = (priceStr && unit)
        ? `${priceStr} · ${unit}`
        : (priceStr || unit || " ");

      return { id, title, description };
    });

    if (products.length === 0) {
      products.push({ id: "no_items", title: "No products available", description: " " });
    }

    const effectiveNotice = notice || ' ';

    // 8. Assemble — every key, every time
    return {
      version,
      screen: 'PRODUCT_SELECT',
      data: {
        categories,
        category_prefill: categoryPrefill,
        banner_url:
          this.configService.get<string>('app.welcomeImageUrl') ?? '',
        products,                                          // array
        pre_selected: Array.isArray(preSelected) ? preSelected : [], // array of strings
        page_label: `Page ${safePage} of ${totalPages} · ${allProducts.length} products`,
        selection_note: `${session.selected.size} items selected so far`,
        search_prefill: session.query || ' ',
        page_options: pageOptions,                       // ≥1 entry
        page_prefill: String(safePage),
        notice: effectiveNotice,                         // " " when nothing
        show_notice: effectiveNotice.trim().length > 0,  // real boolean
      },
    };
  }

  /** Builds the QUANTITIES screen data — all 30 keys always present. */
  private async buildQuantitiesScreen(session: FlowSession, version: string): Promise<any> {
    const selectedArray = Array.from(session.selected);
    const products = await this.productsService.findByIds(selectedArray);

    const screenData: Record<string, any> = {};
    for (let i = 0; i < 10; i++) {
      const p = products[i];
      if (p) {
        const rawName = String(p.name ?? "").trim();
        const match = rawName.match(/^(.*?)\s*\(([^)]+)\)$/);
        const parsedTitle = match ? match[1].trim() : rawName;

        let priceStr = "";
        if (p.price != null && !isNaN(Number(p.price))) {
          priceStr = ` ₵${Number(p.price).toFixed(2)}`;
        }

        const maxNameLen = 20 - priceStr.length;
        let shortName = parsedTitle;
        
        if (shortName.length > maxNameLen) {
          shortName = shortName.substring(0, maxNameLen - 1) + '…';
        }

        screenData[`item_${i}_label`] = `${shortName}${priceStr}`;
        screenData[`item_${i}_id`]   = String(p.id ?? "");
        screenData[`show_${i}`]      = true;            // real boolean
      } else {
        screenData[`item_${i}_label`] = ' ';
        screenData[`item_${i}_id`]   = ' ';
        screenData[`show_${i}`]      = false;           // real boolean
      }
    }

    return { version, screen: 'QUANTITIES', data: screenData };
  }

  // ─── Webhook verification ─────────────────────────────────────────────────

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.challenge') challenge?: string,
    @Query('hub.verify_token') verifyToken?: string,
  ) {
    const expectedToken = this.configService.get<string>('whatsapp.verifyToken');
    if (mode === 'subscribe' && verifyToken === expectedToken) {
      return challenge ?? '';
    }
    return 'Verification failed';
  }

  // ─── Inbound messages ─────────────────────────────────────────────────────

  @Post()
  @HttpCode(200)
  async receiveMessage(
    @Body() body: WhatsAppWebhookBody,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    const messages =
      body.entry?.flatMap(
        (entry) =>
          entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? [],
      ) ?? [];

    this.logger.log(`Webhook received: ${messages.length} message(s)`);

    const appSecret = this.configService.get<string>('whatsapp.appSecret');
    if (appSecret && signature) {
      const rawBody = req.rawBody;
      if (!rawBody) {
        this.logger.warn('Missing raw webhook body; request rejected');
        return { received: false };
      }
      const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
      if (expected !== signature) {
        this.logger.warn('Invalid webhook signature — but continuing for local testing');
      } else {
        this.logger.log('Webhook signature verified');
      }
    }

    for (const msg of messages) {
      if (!msg || !msg.from) continue;

      const messageId = msg.id ?? `${msg.from}:${Date.now()}`;
      this.logger.log(`Processing inbound message ${messageId} from ${msg.from} (${msg.type ?? 'unknown'})`);

      if (!(await this.webhookService.shouldProcess(messageId))) {
        this.logger.log(`Skipping duplicate message ${messageId}`);
        continue;
      }

      const interactive = (msg as any).interactive;

      if (interactive?.type === 'button_reply') {
        const buttonId = interactive.button_reply?.id;
        this.logger.log(`BUTTON SELECTED: ${buttonId} from ${msg.from}`);
        await this.chatService.handleMessage(msg.from!, buttonId);
        continue;
      }

      if (interactive?.type === 'list_reply') {
        const listId = interactive.list_reply?.id;
        this.logger.log(`LIST ITEM SELECTED: ${listId} from ${msg.from}`);
        await this.chatService.handleMessage(msg.from!, listId);
        continue;
      }

      if (interactive?.type === 'nfm_reply' && interactive?.nfm_reply?.response_json) {
        try {
          const flowData = JSON.parse(interactive.nfm_reply.response_json);
          this.logger.log(`FLOW SUBMITTED from ${msg.from}`);
          await this.chatService.handleFlowResponse(msg.from!, flowData);
          continue;
        } catch (e) {
          this.logger.error('Failed to parse flow response', e);
        }
      }

      if (msg.type === 'order' && msg.order) {
        this.logger.log(`CATALOG ORDER RECEIVED from ${msg.from}`);
        await this.chatService.handleCatalogOrder(msg.from!, msg.order);
        continue;
      }

      if (msg.type !== 'text' || !msg.text?.body) continue;

      void (async () => {
        try {
          await this.whatsappService.sendTypingIndicator(messageId);
        } catch {
          this.logger.warn('sendTypingIndicator failed, but continuing...');
        }
        await this.chatService.handleMessage(msg.from!, msg.text!.body!);
      })().catch((e) => {
        this.logger.error('Error in message processing pipeline', e);
      });
    }

    return { received: true };
  }

  // ─── Flow data-exchange endpoint ──────────────────────────────────────────

  @Post('flow')
  @HttpCode(200)
  @Header('content-type', 'text/plain')
  async handleFlowExchange(@Body() body: any) {
    const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body;
    if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
      return { received: false };
    }

    try {
      const decrypted = this.whatsappFlowService.decryptPayload(
        encrypted_flow_data,
        encrypted_aes_key,
        initial_vector,
      );

      const action    = decrypted.payload.action;
      const data      = decrypted.payload.data || {};
      const version   = decrypted.payload.version || '3.0';
      const flowToken = decrypted.payload.flow_token || 'default';
      const session   = this.getSession(flowToken);

      this.logger.log(`Flow: action=${action} step=${data.step ?? '-'} token=${flowToken}`);

      let responseData: any;

      // ── ping ──────────────────────────────────────────────────────────────
      if (action === 'ping') {
        responseData = { version, data: { status: 'active' } };

      // ── INIT ──────────────────────────────────────────────────────────────
      } else if (action === 'INIT') {
        session.query    = '';
        session.category = 'all';
        session.page     = 1;
        session.selected.clear();
        session.lastDisplayedIds = [];
        responseData = await this.buildProductSelectScreen(session, version);

      // ── data_exchange ─────────────────────────────────────────────────────
      } else if (action === 'data_exchange') {
        const selectedOnPage: string[] = Array.isArray(data.selected_on_page)
          ? data.selected_on_page
          : [];

        switch (data.step) {

          // ── search ────────────────────────────────────────────────────────
          case 'search': {
            this.mergeSelection(session, selectedOnPage);
            session.query = (data.query ?? '').trim();
            session.page  = 1;
            responseData  = await this.buildProductSelectScreen(session, version);
            break;
          }

          // ── clear_search ──────────────────────────────────────────────────
          case 'clear_search': {
            this.mergeSelection(session, selectedOnPage);
            session.query = '';
            session.page  = 1;
            responseData  = await this.buildProductSelectScreen(session, version);
            break;
          }

          // ── category ──────────────────────────────────────────────────────
          case 'category': {
            this.mergeSelection(session, selectedOnPage);
            session.category = (data.category ?? 'all').toString().trim() || 'all';
            session.query    = '';  // clear search when switching category
            session.page     = 1;
            responseData     = await this.buildProductSelectScreen(session, version);
            break;
          }

          // ── goto_page ─────────────────────────────────────────────────────
          case 'goto_page': {
            this.mergeSelection(session, selectedOnPage);
            if (data.query !== undefined) {
              session.query = String(data.query).trim();
            }
            session.page = Math.max(1, parseInt(data.page ?? '1', 10) || 1);
            responseData = await this.buildProductSelectScreen(session, version);
            
            this.logger.log(`[DEBUG] Decrypted request payload: ${JSON.stringify(decrypted.payload)}`);
            this.logger.log(`[DEBUG] Plaintext response JSON: ${JSON.stringify(responseData)}`);
            break;
          }

          // ── continue ──────────────────────────────────────────────────────
          case 'continue': {
            this.mergeSelection(session, selectedOnPage);

            if (session.selected.size === 0) {
              responseData = await this.buildProductSelectScreen(
                session, version,
                'Please select at least one product before continuing.',
              );
            } else if (session.selected.size > 10) {
              responseData = await this.buildProductSelectScreen(
                session, version,
                `You have selected ${session.selected.size} items. Please remove some — maximum is 10.`,
              );
            } else {
              responseData = await this.buildQuantitiesScreen(session, version);
            }
            break;
          }

          // ── quantities ───────────────────────────────────────────────────
          case 'quantities': {
            let total = 0;
            const summaryLines: string[] = [];
            const cartArray: { id: string; qty: number }[] = [];

            for (let i = 0; i < 10; i++) {
              const id     = data[`i${i}_id`];
              const qtyStr = data[`i${i}_qty`];
              if (id && qtyStr && Number(qtyStr) > 0) {
                const qty      = Number(qtyStr);
                const [product] = await this.productsService.findByIds([id]);
                if (product) {
                  const lineTotal = Number(product.price) * qty;
                  total += lineTotal;
                  summaryLines.push(`${qty} × ${product.name} — ₵${lineTotal.toFixed(2)}`);
                  cartArray.push({ id: product.id, qty });
                }
              }
            }

            responseData = {
              version,
              screen: 'SUMMARY',
              data: {
                summary_lines: summaryLines.length > 0
                  ? summaryLines.join('\n')
                  : 'No items with quantities entered.',
                order_total: `Total: ₵${total.toFixed(2)}`,
                cart_json: JSON.stringify(cartArray),
              },
            };
            break;
          }

          default: {
            this.logger.warn(`Unknown data_exchange step: ${data.step}`);
            responseData = { version, data: { status: 'active' } };
          }
        }

      } else {
        this.logger.warn(`Unknown flow action: ${action}`);
        responseData = { version, data: { status: 'active' } };
      }

      this.logger.log(`Flow → screen: ${responseData.screen ?? 'n/a'}, selected: ${session.selected.size}`);

      this.runSchemaGuard(responseData);

      return this.whatsappFlowService.encryptResponse(
        responseData,
        decrypted.decryptedAesKey,
        decrypted.initialVectorBuffer,
      );
    } catch (e: any) {
      this.logger.error('Data exchange error', e);
      require('fs').writeFileSync('/tmp/flow-error.log', e.stack || e.message || String(e));
      throw e;
    }
  }
}
