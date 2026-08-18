import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service';
import { ConfigService } from '@nestjs/config';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const whatsappService = app.get(WhatsAppService);
  const configService = app.get(ConfigService);
  
  const to = '233598402862';
  const flowId = configService.get<string>('whatsapp.flowId');
  const flowToken = `test-flow-${Date.now()}`;
  
  if (!flowId) {
    console.error("No WHATSAPP_FLOW_ID found in your .env file!");
    await app.close();
    return;
  }

  const flowData: Record<string, any> = {};
  for (let i = 0; i < 10; i++) {
    flowData[`product_${i}_id`] = i === 0 ? 'test_id' : '';
    flowData[`product_${i}_name`] = i === 0 ? 'Test Item' : '';
    flowData[`product_${i}_price`] = i === 0 ? 'Price: ₵10.00' : '';
    flowData[`visible_${i}`] = i === 0;
  }

  console.log(`Sending Flow message (Flow ID: ${flowId}) to ${to}...`);
  try {
    const res = await whatsappService.sendFlow(
      to,
      "Please fill out this form to complete your order 📝",
      "Open Form",
      flowId,
      flowToken,
      "navigate",
      "PRODUCT_ORDER",
      flowData
    );
    console.log("Flow message sent successfully:", res);
  } catch (err: any) {
    console.error("Failed to send Flow message:", err?.response?.data || err?.message || err);
  }
  
  await app.close();
}

run();
