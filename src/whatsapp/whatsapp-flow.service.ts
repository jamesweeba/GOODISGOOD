import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class WhatsAppFlowService {
  private readonly logger = new Logger(WhatsAppFlowService.name);

  constructor(private readonly configService: ConfigService) {}

  public decryptPayload(
    encryptedFlowData: string,
    encryptedAesKey: string,
    initialVector: string,
  ) {
    const privateKey = this.configService.get<string>('whatsapp.privateKey');
    if (!privateKey) {
      throw new Error('WHATSAPP_PRIVATE_KEY is not configured');
    }

    try {
      const decryptedAesKey = crypto.privateDecrypt(
        {
          key: privateKey.replace(/\\n/g, '\n'),
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(encryptedAesKey, 'base64'),
      );

      const initialVectorBuffer = Buffer.from(initialVector, 'base64');
      const encryptedFlowDataBuffer = Buffer.from(encryptedFlowData, 'base64');

      const authTag = encryptedFlowDataBuffer.subarray(
        encryptedFlowDataBuffer.length - 16,
      );
      const encryptedPayload = encryptedFlowDataBuffer.subarray(
        0,
        encryptedFlowDataBuffer.length - 16,
      );

      const decipher = crypto.createDecipheriv(
        'aes-128-gcm',
        decryptedAesKey,
        initialVectorBuffer,
      );
      decipher.setAuthTag(authTag);

      let decryptedJSONString = decipher.update(encryptedPayload, undefined, 'utf8');
      decryptedJSONString += decipher.final('utf8');

      return {
        decryptedAesKey,
        initialVectorBuffer,
        payload: JSON.parse(decryptedJSONString),
      };
    } catch (e) {
      this.logger.error('Failed to decrypt WhatsApp flow payload', e);
      throw e;
    }
  }

  public encryptResponse(
    responseData: any,
    decryptedAesKey: Buffer,
    initialVectorBuffer: Buffer,
  ) {
    try {
      const flippedIv = Buffer.alloc(initialVectorBuffer.length);
      for (let i = 0; i < initialVectorBuffer.length; i++) {
        flippedIv[i] = ~initialVectorBuffer[i];
      }

      const cipher = crypto.createCipheriv(
        'aes-128-gcm',
        decryptedAesKey,
        flippedIv,
      );

      const encryptedData = cipher.update(JSON.stringify(responseData), 'utf8');
      const finalData = cipher.final();
      const authTag = cipher.getAuthTag();

      return Buffer.concat([encryptedData, finalData, authTag]).toString('base64');
    } catch (e) {
      this.logger.error('Failed to encrypt WhatsApp flow response', e);
      throw e;
    }
  }
}
