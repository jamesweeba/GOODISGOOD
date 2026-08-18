import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { WhatsAppController } from './src/whatsapp/whatsapp.controller';

async function testPage2() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const controller = app.get(WhatsAppController);

  const session = {
    query: '',
    page: 2,
    selected: new Set<string>(),
    lastDisplayedIds: []
  };

  try {
    const res = await (controller as any).buildProductSelectScreen(session, '3.0');
    console.log("Page 2 Response:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Error building page 2:", err);
  }

  await app.close();
}

testPage2();
