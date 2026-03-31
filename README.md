# WhatsApp AI Sales Agent

This project turns the markdown spec into a full NestJS + Prisma application for a single-vendor WhatsApp sales assistant.

It includes:

- NestJS backend with a production-style module layout
- Meta WhatsApp Cloud API webhook verification and outbound messaging
- AI reply generation using OpenAI, Anthropic, or OpenRouter free models
- PostgreSQL + Prisma models for products, carts, orders, and chat history
- Cart viewing, cart updates, order creation, payment-link generation, and cart expiration
- Admin dashboard for sessions, carts, orders, and recent chats
- Seed data so the app can be tested quickly

## Stack

- NestJS
- Prisma ORM
- PostgreSQL
- Meta WhatsApp Cloud API
- OpenAI, Anthropic, or OpenRouter

## Project Structure

```text
src/
  ai/
  chat/
  config/
  database/
  orders/
  payments/
  products/
  whatsapp/
prisma/
  schema.prisma
  seed.ts
```

## Requirements

- Node.js 20+
- PostgreSQL

## Setup

1. Copy the environment file:

```bash
cp .env.example .env
```

2. Update `.env` with your real database, WhatsApp, and AI credentials.

3. Install dependencies:

```bash
npm install
```

4. Generate Prisma client and run migrations:

```bash
npx prisma migrate dev --name init
npx prisma generate
```

5. Seed sample products:

```bash
npm run prisma:seed
```

6. Start the app:

```bash
npm run start:dev
```

The server defaults to `http://localhost:3100`.

### Configurable Phrases

You can customize every direct phrase group with env vars:

```env
GREETING_PHRASES="hi,hello,hey,yo,good morning,good afternoon,good evening,hola"
AFFIRMATIVE_PHRASES="yes,yep,yeah,yup,ok,okay,sure,alright,affirmative,go ahead,sounds good"
NEGATIVE_PHRASES="no,nope,nah,negative,not now"
MAYBE_PHRASES="maybe,perhaps,not sure,unsure"
PRODUCT_LIST_PHRASES="products,list products,menu,show me what you have,in stock,available,have in stock,what do you have,what do you sell,show products,show me products"
PAYMENT_PHRASES="pay,payment,make payment,pay now,checkout,check out,send payment,complete payment,finish payment"
CART_VIEW_PHRASES="cart,view cart"
CART_CLEAR_PHRASES="clear cart,clear my cart,empty cart,remove all"
PURCHASE_PHRASES="want,buy,get,take,need,order,add,both"
REMOVAL_PHRASES="remove,delete,take out,take off,drop,minus,subtract"
```

These phrases bypass the AI and route the message straight to the matching built-in flow.

### Typing Indicator Timing

You can make the bot feel snappier or more human by adjusting the typing delay:

```env
WHATSAPP_TYPING_INDICATOR_DELAY_MS=2500
```

Shorter values make the bot reply faster. Longer values keep the typing indicator visible a bit longer before the reply is sent.

## Webhook Endpoints

- `GET /webhook` verifies the Meta webhook subscription.
- `POST /webhook` receives inbound WhatsApp messages.

## Admin Dashboard

Open `GET /admin` in the browser to view the dashboard. If `ADMIN_TOKEN` is set, pass it as a query parameter:

```text
/admin?token=your-token
```

The dashboard shows:

- Product count
- Persistent user sessions
- Active carts and orders
- Recent chat messages

## AI Behavior Contract

The AI layer is instructed to return only JSON in this format:

```json
{
  "reply": "string",
  "intent": "browse | order | confirm | question | view_cart | update_cart",
  "products": [
    {
      "name": "string",
      "quantity": 1
    }
  ],
  "action": "none | confirm_order | create_order | request_payment"
}
```

Malformed or unavailable AI responses fall back to a safe default response.

## OpenRouter Support

The AI service includes a `generateWithOpenRouterFree(prompt)` method in [src/ai/ai.service.ts](/home/kwasi/Documents/GODISGOOD/src/ai/ai.service.ts) that sends prompts to OpenRouter's chat completions API using the free-model router.

To use it in the app, set:

```env
AI_PROVIDER="openrouter"
OPEN_ROUTER_KEY="your-openrouter-api-key"
OPENROUTER_MODEL="openrouter/free"
```

## Payment Flow

The implementation includes a mock payment-link generator by default. If you set `PAYMENT_PROVIDER=paystack`, the service will generate a Paystack-style URL using the configured base URL.

## Notes

- Product names are unique so AI-selected products can be resolved safely.
- Cart updates are wrapped in Prisma transactions to reduce race-condition issues.
- Pending carts are expired automatically based on `CART_EXPIRY_HOURS`.
- If the active cart becomes empty after an update, it is marked as cancelled.
