#!/usr/bin/env node

const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3100';
const phoneNumber = process.env.SMOKE_PHONE_NUMBER ?? '233123456789';
const messageBody = process.argv.slice(2).join(' ').trim() || 'if you have tomatoes add some to cart';

async function main() {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: `smoke-${Date.now()}`,
                  from: phoneNumber,
                  type: 'text',
                  timestamp: `${Math.floor(Date.now() / 1000)}`,
                  text: {
                    body: messageBody,
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const response = await fetch(`${appBaseUrl}/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  console.log(`Status: ${response.status}`);
  console.log(text);

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
