const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("Set TELEGRAM_BOT_TOKEN first.");
  process.exit(1);
}

async function run() {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`);
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
  const summary = (payload.result || []).map((update) => {
    const message = update.message || update.edited_message || {};
    const chat = message.chat || {};
    return {
      updateId: update.update_id,
      chatId: chat.id,
      chatType: chat.type,
      chatTitle: chat.title || "",
      username: chat.username || "",
      messageThreadId: message.message_thread_id || null,
      text: message.text || ""
    };
  });
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error && error.stack || String(error));
  process.exit(1);
});
