import * as crypto from 'crypto';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config();

const privateKey = process.env.WHATSAPP_PRIVATE_KEY;
if (!privateKey) throw new Error("No key");

const formattedKey = privateKey.replace(/\\n/g, '\n');

console.log("Formatted Key starts with:", formattedKey.substring(0, 30));
console.log("Formatted Key ends with:", formattedKey.substring(formattedKey.length - 30));

try {
  const aesKey = crypto.randomBytes(32);
  
  // Simulate Meta encrypting with public key
  const publicKey = crypto.createPublicKey(formattedKey);
  const encryptedAesKey = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    aesKey
  );

  // Simulate Server decrypting with private key
  const decryptedAesKey = crypto.privateDecrypt(
    {
      key: formattedKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    encryptedAesKey
  );

  if (aesKey.equals(decryptedAesKey)) {
    console.log("SUCCESS: Encryption/Decryption works perfectly.");
  } else {
    console.log("FAILURE: Keys don't match.");
  }
} catch (e) {
  console.error("ERROR:", e);
}
