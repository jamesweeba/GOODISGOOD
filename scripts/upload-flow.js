/**
 * Upload the WhatsApp Flow JSON to Meta.
 * Run:  node scripts/upload-flow.js
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

// Load .env manually (no external deps needed)
const envPath = path.resolve(__dirname, '../.env');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const eq = trimmed.indexOf('=');
  if (eq === -1) return;
  const key = trimmed.slice(0, eq).trim();
  let val   = trimmed.slice(eq + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
});

const FLOW_ID     = process.env.WHATSAPP_FLOW_ID;
const TOKEN       = process.env.WHATSAPP_TOKEN;
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v22.0';
const FLOW_JSON   = path.resolve(__dirname, '../flow.json');

if (!FLOW_ID || !TOKEN) {
  console.error('❌  WHATSAPP_FLOW_ID or WHATSAPP_TOKEN not set in .env');
  process.exit(1);
}

const flowContent = fs.readFileSync(FLOW_JSON, 'utf-8');
const boundary    = '----Boundary' + Date.now();
const fileBytes   = Buffer.from(flowContent, 'utf-8');

const body = Buffer.concat([
  Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="name"\r\n\r\n' +
    'flow.json\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="asset_type"\r\n\r\n' +
    'FLOW_JSON\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="flow.json"\r\n' +
    'Content-Type: application/json\r\n\r\n'
  ),
  fileBytes,
  Buffer.from('\r\n--' + boundary + '--\r\n'),
]);

const options = {
  hostname: 'graph.facebook.com',
  path: '/' + API_VERSION + '/' + FLOW_ID + '/assets',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + TOKEN,
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': body.length,
  },
};

console.log('📤  Uploading flow.json to Flow ' + FLOW_ID + ' …');

const req = https.request(options, function(res) {
  let raw = '';
  res.on('data', function(chunk) { raw += chunk; });
  res.on('end', function() {
    try {
      const parsed = JSON.parse(raw);
      if (res.statusCode === 200 && parsed.success) {
        console.log('✅  Flow uploaded successfully!');
        console.log('   Validation errors (if any):', JSON.stringify(parsed.validation_errors, null, 2));
      } else {
        console.error('❌  Upload failed (HTTP ' + res.statusCode + '):');
        console.error(JSON.stringify(parsed, null, 2));
      }
    } catch(e) {
      console.error('❌  Could not parse response:', raw);
    }
  });
});

req.on('error', function(e) { console.error('❌  Request error:', e.message); });
req.write(body);
req.end();
