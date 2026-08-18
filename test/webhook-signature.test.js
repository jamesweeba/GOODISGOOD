require('ts-node/register/transpile-only');

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { WhatsAppController } = require('../src/whatsapp/whatsapp.controller');
const { PaymentsController } = require('../src/payments/payments.controller');

test('verifies WhatsApp webhook signatures against the raw request body', async () => {
  const rawBody = Buffer.from('{\n  "entry": []\n}');
  const appSecret = 'whatsapp-app-secret';
  const signature =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const controller = new WhatsAppController(
    {
      handleMessage: async () => {
        throw new Error('handleMessage should not be called');
      },
    },
    {
      get: (key) => (key === 'whatsapp.appSecret' ? appSecret : undefined),
    },
    {
      shouldProcess: async () => true,
    },
    {
      sendTypingIndicator: async () => true,
    },
  );

  const result = await controller.receiveMessage(
    { entry: [] },
    { rawBody },
    signature,
  );

  assert.deepEqual(result, { received: true });
});

test('rejects WhatsApp webhook signatures when the raw body is missing', async () => {
  const controller = new WhatsAppController(
    {
      handleMessage: async () => {
        throw new Error('handleMessage should not be called');
      },
    },
    {
      get: (key) => (key === 'whatsapp.appSecret' ? 'whatsapp-app-secret' : undefined),
    },
    {
      shouldProcess: async () => true,
    },
    {
      sendTypingIndicator: async () => true,
    },
  );

  const result = await controller.receiveMessage(
    { entry: [] },
    {},
    'sha256=invalid',
  );

  assert.deepEqual(result, { received: false });
});

test('verifies Paystack webhook signatures against the raw request body', async () => {
  const rawBody = Buffer.from('{\n  "event": "charge.success",\n  "data": {\n    "reference": "ref-123",\n    "metadata": {\n      "orderId": "order-1"\n    }\n  }\n}');
  const secret = 'paystack-secret';
  const signature = crypto
    .createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex');
  let markedOrderId = null;

  const controller = new PaymentsController(
    {
      markAsPaid: async (orderId) => {
        markedOrderId = orderId;
      },
    },
    {
      get: (key) => (key === 'payments.paystackSecretKey' ? secret : undefined),
    },
  );

  const result = await controller.handlePaystackWebhook(
    {
      event: 'charge.success',
      data: {
        reference: 'ref-123',
        metadata: { orderId: 'order-1' },
      },
    },
    signature,
    { rawBody },
  );

  assert.deepEqual(result, { status: 'success' });
  assert.equal(markedOrderId, 'order-1');
});
