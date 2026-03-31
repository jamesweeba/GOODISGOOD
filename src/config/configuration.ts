type Environment = Record<string, string | undefined>;

function requireString(
  env: Environment,
  key: string,
  fallback?: string,
): string {
  const value = env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseList(value: string | undefined, fallback: string[]) {
  const source = value ?? fallback.join(',');

  return source
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

export function validateEnvironment(env: Environment) {
  const provider = env.AI_PROVIDER ?? "openai";

  requireString(env, "DATABASE_URL");
  requireString(env, "WHATSAPP_TOKEN");
  requireString(env, "WHATSAPP_PHONE_ID");
  requireString(env, "WHATSAPP_VERIFY_TOKEN");

  if (provider === "openai") {
    requireString(env, "OPENAI_API_KEY");
  }

  if (provider === "anthropic") {
    requireString(env, "ANTHROPIC_API_KEY");
  }

  if (provider === "openrouter") {
    requireString(env, "OPEN_ROUTER_KEY");
  }

  return env;
}

export function configuration() {
  const productListPhrases = parseList(process.env.PRODUCT_LIST_PHRASES, [
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
  ]);

  return {
    app: {
      port: Number(process.env.PORT ?? 3100),
      baseUrl: process.env.APP_BASE_URL ?? "http://localhost:3100",
    },
    whatsapp: {
      token: process.env.WHATSAPP_TOKEN,
      phoneId: process.env.WHATSAPP_PHONE_ID,
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
      apiVersion: process.env.WHATSAPP_API_VERSION ?? "v21.0",
      typingIndicatorDelayMs: Number(
        process.env.WHATSAPP_TYPING_INDICATOR_DELAY_MS ?? 2500,
      ),
    },
    ai: {
      provider: process.env.AI_PROVIDER ?? "openai",
      openaiApiKey: process.env.OPENAI_API_KEY,
      openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      anthropicModel:
        process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022",
    },
    payments: {
      provider: process.env.PAYMENT_PROVIDER ?? "mock",
      paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY,
      paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
      paystackBaseUrl:
        process.env.PAYSTACK_BASE_URL ?? "https://paystack.com/pay",
    },
    chat: {
      productListPhrases,
      phrases: {
        greeting: parseList(process.env.GREETING_PHRASES, [
          'hi',
          'hello',
          'hey',
          'yo',
          'good morning',
          'good afternoon',
          'good evening',
          'hola',
        ]),
        affirmative: parseList(process.env.AFFIRMATIVE_PHRASES, [
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
        ]),
        negative: parseList(process.env.NEGATIVE_PHRASES, [
          'no',
          'nope',
          'nah',
          'negative',
          'not now',
        ]),
        maybe: parseList(process.env.MAYBE_PHRASES, [
          'maybe',
          'perhaps',
          'not sure',
          'unsure',
        ]),
        productList: productListPhrases,
        payment: parseList(process.env.PAYMENT_PHRASES, [
          'pay',
          'payment',
          'make payment',
          'pay now',
          'checkout',
          'check out',
          'send payment',
          'complete payment',
          'finish payment',
        ]),
        cartView: parseList(process.env.CART_VIEW_PHRASES, [
          'cart',
          'view cart',
        ]),
        cartClear: parseList(process.env.CART_CLEAR_PHRASES, [
          'clear cart',
          'clear my cart',
          'empty cart',
          'remove all',
        ]),
        purchase: parseList(process.env.PURCHASE_PHRASES, [
          'want',
          'buy',
          'get',
          'take',
          'need',
          'order',
          'add',
          'both',
        ]),
        removal: parseList(process.env.REMOVAL_PHRASES, [
          'remove',
          'delete',
          'take out',
          'take off',
          'drop',
          'minus',
          'subtract',
        ]),
      },
    },
    cart: {
      expiryHours: Number(process.env.CART_EXPIRY_HOURS ?? 24),
    },
  };
}
