require('ts-node/register/transpile-only');

const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');
const { WhatsAppService } = require('../src/whatsapp/whatsapp.service');

test('falls back to a read receipt when typing indicators fail', async () => {
  const originalPost = axios.post;
  const calls = [];

  axios.post = async (_url, payload) => {
    calls.push(payload);

    if (calls.length <= 3) {
      throw new Error('typing indicator rejected');
    }

    return {
      data: {
        success: true,
      },
    };
  };

  try {
    const service = new WhatsAppService({
      get: (key) => {
        if (key === 'whatsapp.token') {
          return 'test-token';
        }

        if (key === 'whatsapp.phoneId') {
          return '123456';
        }

        if (key === 'whatsapp.apiVersion') {
          return 'v21.0';
        }

        return undefined;
      },
    });

    const result = await service.sendTypingIndicator('wamid.test-message');

    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0], {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.test-message',
      typing_indicator: {
        type: 'text',
      },
    });
    assert.deepEqual(calls[1], calls[0]);
    assert.deepEqual(calls[2], calls[0]);
    assert.deepEqual(calls[3], {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.test-message',
    });
    assert.equal(result, false);
  } finally {
    axios.post = originalPost;
  }
});

test('retries typing indicator before falling back', async () => {
  const originalPost = axios.post;
  const calls = [];

  axios.post = async (_url, payload) => {
    calls.push(payload);

    if (calls.length < 3) {
      throw new Error('temporary network issue');
    }

    return {
      data: {
        success: true,
      },
    };
  };

  try {
    const service = new WhatsAppService({
      get: (key) => {
        if (key === 'whatsapp.token') {
          return 'test-token';
        }

        if (key === 'whatsapp.phoneId') {
          return '123456';
        }

        if (key === 'whatsapp.apiVersion') {
          return 'v21.0';
        }

        return undefined;
      },
    });

    const result = await service.sendTypingIndicator('wamid.retry-message');

    assert.equal(result, true);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(calls[1], calls[2]);
  } finally {
    axios.post = originalPost;
  }
});
