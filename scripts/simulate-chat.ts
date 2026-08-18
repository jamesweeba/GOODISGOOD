import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/chat/chat.service';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service';

async function runSimulation() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const chatService = app.get(ChatService);
  const whatsappService = app.get(WhatsAppService);

  const testUserPhone = '0598402862';

  // Mock WhatsAppService to log to console instead of calling Meta API
  (whatsappService as any).sendMessage = async (to: string, text: string) => {
    console.log(`\n[BOT to ${to}]:\n${text}\n-------------------`);
    return { data: { success: true } };
  };

  (whatsappService as any).sendInteractiveButtons = async (to: string, text: string, buttons: any[]) => {
    console.log(`\n[BOT to ${to} (BUTTONS)]: \n${text}\nButtons: ${JSON.stringify(buttons)}\n-------------------`);
    return { data: { success: true } };
  };

  (whatsappService as any).sendFlow = async (to: string, body: string, buttonText: string) => {
    console.log(`\n[BOT to ${to} (FLOW)]: \n${body}\n[Button: ${buttonText}]\n-------------------`);
    return { data: { success: true } };
  };

  console.log('--- STARTING SIMULATION ---');

  // Step 1: User says Hi
  console.log(`\n[USER]: Hi`);
  await chatService.handleMessage(testUserPhone, 'Hi');

  // Wait a bit for AI response
  await new Promise(r => setTimeout(r, 2000));

  // Step 2: User asks for foodstuffs
  console.log(`\n[USER]: I want to buy 2 paint buckets of tomatoes and 3 tubers of pona yam`);
  await chatService.handleMessage(testUserPhone, 'I want to buy 2 paint buckets of tomatoes and 3 tubers of pona yam');

  await new Promise(r => setTimeout(r, 3000));

  // Step 3: User confirms
  console.log(`\n[USER]: Yes, confirm`);
  await chatService.handleMessage(testUserPhone, 'Yes, confirm');

  await new Promise(r => setTimeout(r, 1000));

  // Step 4: Simulate Flow Response (Since we can't "send" a message back for a flow easily in text chat, we call the handler)
  console.log(`\n[USER SUBMITS FLOW FORM]: { full_name: "Kwasi Mensah", shipping_address: "Kaneshie Market, Row C" }`);
  await chatService.handleFlowResponse(testUserPhone, {
    full_name: "Kwasi Mensah",
    shipping_address: "Kaneshie Market, Row C"
  });

  console.log('\n--- SIMULATION COMPLETE ---');
  await app.close();
}

runSimulation().catch(err => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
