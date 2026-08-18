import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const whatsappService = app.get(WhatsAppService);
  
  const to = '233598402862';
  console.log(`Sending message to ${to}...`);
  try {
    const res = await whatsappService.sendMessage(to, "Hello! This is a test message from your AI Sales Agent. Let me know if you received this!");
    console.log("Message sent successfully!");
  } catch (err: any) {
    console.error("Failed to send message:", err?.response?.data || err?.message || err);
  }
  
  await app.close();
}

run();
