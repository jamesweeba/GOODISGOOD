require('ts-node/register/transpile-only');

const assert = require('node:assert/strict');
const test = require('node:test');
const { AiService } = require('../src/ai/ai.service');
const { ChatService } = require('../src/chat/chat.service');
const axios = require('axios');

function createChatService(overrides = {}) {
  const prisma =
    overrides.prisma ??
    {
      chatHistory: {
        create: async () => ({}),
        findMany: async () => [],
      },
      userSession: {
        findUnique: async () => null,
        upsert: async () => ({}),
        update: async () => ({}),
      },
    };

  const aiService =
    overrides.aiService ??
    {
      generateReply: async () => JSON.stringify({ reply: 'ok', intent: 'question', products: [], action: 'none' }),
      parseReply: (raw) => JSON.parse(raw),
    };

  const productsService =
    overrides.productsService ??
    {
      listAvailableProducts: async () => [],
    };

  const whatsappService =
    overrides.whatsappService ??
    {
      sendMessage: async () => ({}),
    };

  const ordersService =
    overrides.ordersService ??
    {
      maybeExpireOldCarts: async () => ({}),
      getPaymentMessage: async () => null,
      viewCart: async () => 'cart',
      updateCart: async () => 'updated',
      removeItemsFromCart: async () => 'removed',
      addItemsToCart: async () => 'added',
      clearCart: async () => 'cleared',
      cancelPending: async () => null,
      createOrderMulti: async () => ({ total: 0 }),
    };

  const configService =
    overrides.configService ??
    {
      get: (key) => {
        const defaults = {
          'chat.phrases.greeting': [
            'hi',
            'hello',
            'hey',
            'yo',
            'good morning',
            'good afternoon',
            'good evening',
            'hola',
          ],
          'chat.phrases.affirmative': [
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
          'chat.phrases.negative': ['no', 'nope', 'nah', 'negative', 'not now'],
          'chat.phrases.maybe': ['maybe', 'perhaps', 'not sure', 'unsure'],
          'chat.phrases.productList': [
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
          'chat.phrases.payment': [
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
          'chat.phrases.cartView': ['cart', 'view cart'],
          'chat.phrases.cartClear': ['clear cart', 'clear my cart', 'empty cart', 'remove all'],
          'chat.phrases.purchase': ['want', 'buy', 'get', 'take', 'need', 'order', 'add', 'both'],
          'chat.phrases.removal': [
            'remove',
            'delete',
            'take out',
            'take off',
            'drop',
            'minus',
            'subtract',
          ],
        };

        return defaults[key];
      },
    };

  return new ChatService(
    prisma,
    aiService,
    productsService,
    whatsappService,
    ordersService,
    configService,
  );
}

test('routes payment requests directly to the payment flow', async () => {
  let paymentCalls = 0;
  const service = createChatService({
    ordersService: {
      getPaymentMessage: async () => {
        paymentCalls += 1;
        return 'PAYMENT LINK';
      },
    },
  });

  const reply = await service.tryDirectCommand('233123456789', 'i want to make payment');

  assert.equal(paymentCalls, 1);
  assert.deepEqual(reply, {
    text: 'PAYMENT LINK',
    state: {
      type: 'request_payment',
    },
  });
});

test('removes exactly one matching item from the cart', async () => {
  let capturedItems = null;
  const service = createChatService({
    productsService: {
      listAvailableProducts: async () => [
        { name: 'Canvas', price: 10, description: null },
      ],
    },
    ordersService: {
      removeItemsFromCart: async (_phone, items) => {
        capturedItems = items;
        return 'Removed 1 Canvas';
      },
    },
  });

  const reply = await service.tryDirectCommand('233123456789', 'remove 1 canvas from cart');

  assert.deepEqual(capturedItems, [{ name: 'Canvas', quantity: 1 }]);
  assert.match(reply.text, /Removed from your cart/i);
  assert.match(reply.text, /Removed 1 Canvas/i);
});

test('clears the cart when the user says "clear my cart"', async () => {
  let clearCalls = 0;
  const service = createChatService({
    ordersService: {
      clearCart: async () => {
        clearCalls += 1;
        return 'Your cart has been cleared.';
      },
    },
  });

  const reply = await service.tryDirectCommand('233123456789', 'clear my cart');

  assert.equal(clearCalls, 1);
  assert.equal(reply.text, 'Your cart has been cleared.');
});

test('shows the cart for a typo like "show me items in my car"', async () => {
  let viewCalls = 0;
  const service = createChatService({
    ordersService: {
      viewCart: async () => {
        viewCalls += 1;
        return 'Items in your cart:';
      },
    },
  });

  const reply = await service.tryDirectCommand('233123456789', 'show me items in my car');

  assert.equal(viewCalls, 1);
  assert.equal(reply.text, 'Items in your cart:');
});

test('confirms availability with the requested exact wording', async () => {
  let addCalls = 0;
  const service = createChatService({
    productsService: {
      listAvailableProducts: async () => [
        { name: 'Tomatoes', price: 10, description: 'Fresh tomatoes' },
        { name: 'Frame', price: 5, description: 'Wooden frame' },
      ],
    },
    ordersService: {
      addItemsToCart: async () => {
        addCalls += 1;
        return 'should not be called';
      },
    },
  });

  const reply = await service.tryDirectCommand(
    '233123456789',
    'if you have tomatoes add some to cart',
  );

  assert.equal(
    reply.text,
    'Yes, we have Tomatoes. Want me to add them to your cart?',
  );
  assert.equal(addCalls, 0);
});

test('explains when a requested product is not available and suggests alternatives', async () => {
  const service = createChatService({
    productsService: {
      listAvailableProducts: async () => [
        { name: 'Canvas', price: 10, description: 'Art canvas' },
        { name: 'Frame', price: 5, description: 'Wooden frame' },
      ],
    },
  });

  const reply = await service.tryDirectCommand('233123456789', 'do you have iphone?');

  assert.equal(reply.text, 'Sorry, we do not have iphone right now, but we do have Canvas and Frame.');
});

test('shows the product list for "show me what you have"', async () => {
  const service = createChatService({
    productsService: {
      listAvailableProducts: async () => [
        { name: 'Canvas', price: 10, description: 'Art canvas' },
        { name: 'Frame', price: 5, description: 'Wooden frame' },
      ],
    },
  });

  const reply = await service.tryDirectCommand('233123456789', 'show me what you have');

  assert.match(reply.text, /We have the following products in stock:/i);
  assert.match(reply.text, /Canvas - \$10\.00 - Art canvas/);
  assert.match(reply.text, /Frame - \$5\.00 - Wooden frame/);
});

test('shows the product list for "what do you have"', async () => {
  const service = createChatService({
    productsService: {
      listAvailableProducts: async () => [
        { name: 'Canvas Tote', price: 14, description: 'Durable tote bag' },
        { name: 'Classic Tee', price: 19, description: 'Soft cotton tee' },
        { name: 'Premium Hoodie', price: 42, description: 'Heavyweight hoodie' },
      ],
    },
  });

  const reply = await service.tryDirectCommand('233123456789', 'what do you have');

  assert.match(reply.text, /We have the following products in stock:/i);
  assert.match(reply.text, /Canvas Tote - \$14\.00 - Durable tote bag/);
  assert.match(reply.text, /Classic Tee - \$19\.00 - Soft cotton tee/);
  assert.match(reply.text, /Premium Hoodie - \$42\.00 - Heavyweight hoodie/);
});

test('uses configured product list phrases from config', async () => {
  const service = createChatService({
    configService: {
      get: (key) => {
        if (key === 'chat.phrases.productList') {
          return ['show me the catalog'];
        }

        return undefined;
      },
    },
    productsService: {
      listAvailableProducts: async () => [
        { name: 'Canvas', price: 10, description: 'Art canvas' },
      ],
    },
  });

  const reply = await service.tryDirectCommand('233123456789', 'show me the catalog');

  assert.match(reply.text, /We have the following products in stock:/i);
  assert.match(reply.text, /Canvas - \$10\.00 - Art canvas/);
});

test('falls back to a useful payment intent when the AI provider fails', async () => {
  const originalPost = axios.post;
  const originalSetTimeout = global.setTimeout;
  axios.post = async () => {
    throw new Error('network down');
  };
  global.setTimeout = (fn) => {
    fn();
    return 0;
  };

  try {
    const aiService = new AiService({
      get: (key) => {
        if (key === 'ai.provider') {
          return 'openrouter';
        }

        if (key === 'ai.openRouterApiKey') {
          return 'test';
        }

        if (key === 'ai.openRouterModel') {
          return 'test-model';
        }

        return undefined;
      },
    });

    const raw = await aiService.generateReply({
      message: 'i want to make payment',
      products: [],
      history: [],
    });
    const reply = aiService.parseReply(raw);

    assert.equal(reply.action, 'request_payment');
  } finally {
    axios.post = originalPost;
    global.setTimeout = originalSetTimeout;
  }
});

test('sends a prompt with aligned intent guidance to the LLM', async () => {
  const originalPost = axios.post;
  let capturedPrompt = '';

  axios.post = async (url, body) => {
    capturedPrompt = body.input ?? body.messages?.[0]?.content ?? '';

    return {
      data: {
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  reply: 'ok',
                  intent: 'browse',
                  products: [],
                  action: 'none',
                }),
              },
            ],
          },
        ],
      },
    };
  };

  try {
    const aiService = new AiService({
      get: (key) => {
        if (key === 'ai.provider') {
          return 'openai';
        }

        if (key === 'ai.openaiApiKey') {
          return 'test';
        }

        if (key === 'ai.openaiModel') {
          return 'gpt-4.1-mini';
        }

        return undefined;
      },
    });

    await aiService.generateReply({
      message: 'what do you have',
      products: [
        { name: 'Canvas Tote', price: 14, description: 'Durable tote bag' },
      ],
      history: [],
    });

    assert.match(capturedPrompt, /Intent guide:/i);
    assert.match(capturedPrompt, /If the user asks for all products or what is available, use intent "browse"/i);
    assert.match(capturedPrompt, /If the user asks about a specific item, use intent "question"/i);
    assert.match(capturedPrompt, /User: show my cart/i);
    assert.match(capturedPrompt, /Expected output:/i);
    assert.match(capturedPrompt, /```json/i);
    assert.match(capturedPrompt, /"intent": "view_cart"/i);
    assert.match(capturedPrompt, /"action": "none"/i);
    assert.match(capturedPrompt, /User: change canvas tote to 3/i);
    assert.match(capturedPrompt, /"intent": "update_cart"/i);
    assert.match(capturedPrompt, /"products": \[\{"name": "Canvas Tote", "quantity": 3\}\]/i);
    assert.match(capturedPrompt, /User: remove canvas tote/i);
    assert.match(capturedPrompt, /"intent": "remove_from_cart"/i);
    assert.match(capturedPrompt, /"products": \[\{"name": "Canvas Tote", "quantity": 1\}\]/i);
    assert.match(capturedPrompt, /User: what do you have/i);
  } finally {
    axios.post = originalPost;
  }
});
