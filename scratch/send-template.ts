import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const configService = app.get(ConfigService);
  
  const to = '233598402862';
  const token = configService.get<string>("whatsapp.token");
  const phoneId = configService.get<string>("whatsapp.phoneId");
  const apiVersion = configService.get<string>("whatsapp.apiVersion");

  const payload = {
    messaging_product: "whatsapp",
    to: to,
    type: "template",
    template: {
      name: "hello_world",
      language: {
        code: "en_US"
      }
    }
  };

  console.log(`Sending template to ${to}...`);
  try {
    const response = await axios.post(
      `https://graph.facebook.com/${apiVersion}/${phoneId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Template sent successfully:", response.data);
  } catch (err: any) {
    console.error("Failed to send template:", err?.response?.data || err?.message || err);
  }
  
  await app.close();
}

run();
