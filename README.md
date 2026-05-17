# selltomakemoney.com

A single dealer storefront for selltomakemoney.com: visitors can browse products, but only approved logged-in dealers can see pricing.

## Run locally

```powershell
npm install
npm start
```

Open `http://localhost:3000`.

## Admin login

- Email: `k.prathab@gmail.com`
- Temporary password: `DealerStore!2026`

Change the password after first login. You can override the seeded password before the first run with:

```powershell
$env:ADMIN_PASSWORD="your-new-password"; npm start
```

## What is included

- SQLite database in `data/store.db`
- Uploaded product image storage in `uploads/`
- Dealer registration with pending approval
- Admin approval screen
- Product management screen
- Public catalog with prices hidden until login and approval

## Railway deployment

Railway can deploy this repo with the included `railway.json`.

Recommended Railway variables:

```text
SESSION_SECRET=use-a-long-random-secret
ADMIN_PASSWORD=change-this-before-first-production-run
AMAZON_AFFILIATE_TAG=dealerstore-20
DATABASE_URL=${{Postgres.DATABASE_URL}}
WHATSAPP_ACCESS_TOKEN=meta-cloud-api-token
WHATSAPP_PHONE_NUMBER_ID=your-whatsapp-business-phone-number-id
WHATSAPP_NOTIFY_TO=15551234567
# Optional: use an approved template for production proactive alerts
WHATSAPP_TEMPLATE_NAME=new_signup_alert
WHATSAPP_TEMPLATE_LANGUAGE=en_US
TELEGRAM_BOT_TOKEN=telegram-bot-token-from-botfather
TELEGRAM_NOTIFY_CHAT_ID=-1001234567890
# Optional: set when using Telegram forum topics / message threads
TELEGRAM_MESSAGE_THREAD_ID=1234
TELEGRAM_WEBHOOK_SECRET=long-random-secret
TELEGRAM_PROJECT_NAME=selltomakemoney.com
```

Production data should live in Railway Postgres. The app still supports `DB_PATH=/data/store.json` as a local/simple fallback, but Postgres is preferred for the live site.

Uploaded product images are stored in `uploads/`; for production permanence, mount a Railway volume for uploads too or connect cloud object storage later.

## Price comparisons

Products support UPCs and saved competitor price comparisons. Admin users can add comparison rows for Amazon, Walmart, eBay, Google Shopping, or any other site. The storefront shows those comparison prices publicly while keeping your dealer price hidden until the dealer is approved and logged in.

Amazon search links include the affiliate tracking tag from `AMAZON_AFFILIATE_TAG`, defaulting to `dealerstore-20`.

## WhatsApp signup alerts

If `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_NOTIFY_TO` are set, new registrations trigger a WhatsApp notification to the configured destination number. For production proactive alerts, use an approved WhatsApp template by also setting `WHATSAPP_TEMPLATE_NAME`.

## Telegram bot setup

The app supports Telegram notifications and a reusable webhook-based bot command flow.

What it sends:

- New account registrations
- New alert signups
- New orders

What the bot can do:

- `/help`
- `/status`

Recommended setup:

1. Create a bot with BotFather and copy the bot token.
2. Add the bot to your Telegram group.
3. Send a message in the group, or in the specific forum topic if you use topics.
4. Run `npm run telegram:get-updates` with `TELEGRAM_BOT_TOKEN` set to find the correct `chatId` and optional `messageThreadId`.
5. Set these Railway variables:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_NOTIFY_CHAT_ID=-1001234567890
TELEGRAM_MESSAGE_THREAD_ID=1234
TELEGRAM_WEBHOOK_SECRET=long-random-secret
TELEGRAM_WEBHOOK_BASE_URL=https://selltomakemoney.com
```

6. Run `npm run telegram:set-webhook` to point Telegram at:

```text
https://selltomakemoney.com/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>
```

Notes:

- `TELEGRAM_MESSAGE_THREAD_ID` is optional and is useful if you want one Telegram topic per project.
- If you only want notifications and do not need commands, the webhook is optional.

## Reuse in other projects

This repo now includes a reusable Telegram module in [lib/telegram-control.js](C:/Users/T470/Documents/New%20project%204/lib/telegram-control.js).

To reuse it in another project:

1. Copy `lib/telegram-control.js`.
2. Set these env vars in the new project:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_NOTIFY_CHAT_ID=...
TELEGRAM_MESSAGE_THREAD_ID=...
TELEGRAM_WEBHOOK_SECRET=...
TELEGRAM_PROJECT_NAME=your-project-name
```

3. Create a project-specific status builder.
4. Initialize the bot with `createTelegramProjectBot(...)`.
5. Use `bot.notify(...)` for alerts and `bot.handleWebhook(req, res)` for Telegram commands.

The reusable layer is designed so each project only needs to provide:

- project name
- status text builder
- optional extra command handlers
- event-specific message formatting
