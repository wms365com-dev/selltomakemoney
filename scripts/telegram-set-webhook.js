const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_WEBHOOK_BASE_URL = (process.env.TELEGRAM_WEBHOOK_BASE_URL || "").replace(/\/+$/, "");
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_BASE_URL || !TELEGRAM_WEBHOOK_SECRET) {
  console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_BASE_URL, and TELEGRAM_WEBHOOK_SECRET first.");
  process.exit(1);
}

async function run() {
  const url = `${TELEGRAM_WEBHOOK_BASE_URL}/api/telegram/webhook/${TELEGRAM_WEBHOOK_SECRET}`;
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      drop_pending_updates: false
    })
  });
  const payload = await response.json();
  console.log(JSON.stringify({ url, payload }, null, 2));
  if (!response.ok || !payload.ok) process.exit(1);
}

run().catch((error) => {
  console.error(error && error.stack || String(error));
  process.exit(1);
});
