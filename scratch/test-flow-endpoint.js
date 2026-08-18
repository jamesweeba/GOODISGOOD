const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');

async function testFlowEndpoint(action, data) {
  const publicKeyStr = fs.readFileSync('scratch/public_key.pem', 'utf8');
  
  // Generate AES key and IV
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  // Encrypt AES key with RSA
  const encryptedAesKey = crypto.publicEncrypt(
    { key: publicKeyStr, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey
  ).toString('base64');

  // Encrypt payload with AES-GCM
  const payload = { action, version: '3.0', flow_token: 'test-token', data };
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  const finalEncrypted = Buffer.concat([encrypted, authTag]).toString('base64');

  console.log(`\n=== Testing action: ${action} ===`);
  console.log(`Sent payload: ${JSON.stringify(payload)}`);

  try {
    const response = await axios.post('http://localhost:3100/webhook/flow', {
      encrypted_flow_data: finalEncrypted,
      encrypted_aes_key: encryptedAesKey,
      initial_vector: iv.toString('base64')
    });

    console.log(`Status: ${response.status}`);
    console.log(`Content-Type: ${response.headers['content-type']}`);

    // Decrypt the response
    const responseStr = response.data;
    const flippedIv = Buffer.alloc(iv.length);
    for (let i = 0; i < iv.length; i++) { flippedIv[i] = ~iv[i]; }

    const respBuf = Buffer.from(responseStr, 'base64');
    const respAuthTag = respBuf.subarray(respBuf.length - 16);
    const respEncrypted = respBuf.subarray(0, respBuf.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, flippedIv);
    decipher.setAuthTag(respAuthTag);
    let decrypted = decipher.update(respEncrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    console.log(`Decrypted response: ${decrypted}`);
    const parsed = JSON.parse(decrypted);
    console.log(`Has version: ${!!parsed.version}`);
    console.log(`Has screen: ${!!parsed.screen}`);
    console.log(`Has data: ${!!parsed.data}`);
  } catch (e) {
    console.error(`ERROR: ${e.response?.status} ${e.response?.data || e.message}`);
  }
}

(async () => {
  // Test 1: ping
  await testFlowEndpoint('ping', {});

  // Test 2: INIT
  await testFlowEndpoint('INIT', {});

  // Test 3: data_exchange (select)
  await testFlowEndpoint('data_exchange', { 
    step: 'select', 
    selected: ['31d87bae-e489-4601-aa75-329200c70b44', 'ccd8ad27-40e9-4450-9984-84162eb795b2'] 
  });
})();
