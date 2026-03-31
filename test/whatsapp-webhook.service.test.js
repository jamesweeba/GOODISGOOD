require('ts-node/register/transpile-only');

const assert = require('node:assert/strict');
const test = require('node:test');
const { WhatsAppWebhookService } = require('../src/whatsapp/whatsapp-webhook.service');

function createPrismaStore() {
  const store = new Map();

  return {
    store,
    prisma: {
      webhookDeduplication: {
        create: async ({ data }) => {
          if (store.has(data.messageId)) {
            throw { code: 'P2002' };
          }

          store.set(data.messageId, {
            messageId: data.messageId,
            expiresAt: data.expiresAt,
          });

          return {
            id: 'test-id',
            messageId: data.messageId,
            expiresAt: data.expiresAt,
          };
        },
        deleteMany: async ({ where }) => {
          let deleted = 0;
          const cutoff = where?.expiresAt?.lt;

          for (const [messageId, record] of store.entries()) {
            if (cutoff && record.expiresAt < cutoff) {
              store.delete(messageId);
              deleted += 1;
            }
          }

          return { count: deleted };
        },
      },
    },
  };
}

test('stores processed webhook ids so duplicates are rejected across instances', async () => {
  const { prisma } = createPrismaStore();
  const firstService = new WhatsAppWebhookService(prisma);
  const secondService = new WhatsAppWebhookService(prisma);

  assert.equal(await firstService.shouldProcess('message-1'), true);
  assert.equal(await secondService.shouldProcess('message-1'), false);
});
