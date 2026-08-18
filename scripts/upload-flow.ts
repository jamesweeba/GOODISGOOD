/**
 * Upload/update the WhatsApp Flow asset to Meta.
 * Usage:  npx ts-node -r tsconfig-paths/register scripts/upload-flow.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const FLOW_ID      = process.env.WHATSAPP_FLOW_ID!;
const TOKEN        = process.env.WHATSAPP_TOKEN!;
const API_VERSION  = process.env.WHATSAPP_API_VERSION ?? 'v22.0';
const FLOW_JSON    = path.resolve(__dirname, '../flow.json');

if (!FLOW_ID || !TOKEN) {
  console.error('❌  WHATSAPP_FLOW_ID or WHATSAPP_TOKEN not set in .env');
  process.exit(1);
}

const flowContent = fs.readFileSync(FLOW_JSON, 'utf-8');

// Meta requires multipart/form-data for this endpoint
const boundary = `----Boundary${Date.now()}`;
const fileBytes = Buffer.from(flowContent, 'utf-8');

const body = Buffer.concat([
  Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="name"\r\n\r\n` +
    `flow.json\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="asset_type"\r\n\r\n` +
    `FLOW_JSON\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="flow.json"\r\n` +
    `Content-Type: application/json\r\n\r\n`
  ),
  fileBytes,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);

const options: https.RequestOptions = {
  hostname: 'graph.facebook.com',
  path: `/${API_VERSION}/${FLOW_ID}/assets`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
  },
};

console.log(`📤  Uploading flow.json to Flow ${FLOW_ID} …`);

const req = https.request(options, (res) => {
  let raw = '';
  res.on('data', (chunk) => (raw += chunk));
  res.on('end', () => {
    const parsed = JSON.parse(raw);
    if (res.statusCode === 200 && parsed.success) {
      console.log('✅  Flow uploaded successfully!');
      console.log('   Remember to PUBLISH the flow in Meta Business Suite if it is no longer a draft.');
    } else {
      console.error('❌  Upload failed:', JSON.stringify(parsed, null, 2));
    }
  });
});

req.on('error', (e) => console.error('❌  Request error:', e.message));
req.write(body);
req.end();
