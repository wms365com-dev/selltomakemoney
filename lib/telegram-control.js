function parseIntegerValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeCommand(text = "") {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^\/([a-z0-9_]+)(?:@\w+)?\b/i);
  return match ? match[1].toLowerCase() : "";
}

function createTelegramProjectBot(config = {}) {
  const {
    botToken = "",
    defaultChatId = "",
    defaultMessageThreadId = "",
    webhookSecret = "",
    projectName = "Project",
    helpLines = [],
    getStatusMessage,
    commandHandlers = {}
  } = config;

  function notificationsEnabled() {
    return Boolean(botToken && defaultChatId);
  }

  async function sendMessage(text, options = {}) {
    const chatId = String(options.chatId || defaultChatId || "").trim();
    if (!botToken || !chatId) return { skipped: true, reason: "missing_config" };
    const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const messageThreadId = parseIntegerValue(options.messageThreadId ?? defaultMessageThreadId);
    const payload = {
      chat_id: chatId,
      text: String(text || "").trim(),
      disable_web_page_preview: true
    };
    if (messageThreadId) payload.message_thread_id = messageThreadId;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Telegram notify failed: ${response.status} ${errorBody}`.trim());
    }
    return response.json().catch(() => ({ ok: true }));
  }

  async function notify(text, options = {}) {
    if (!notificationsEnabled()) return { skipped: true, reason: "missing_config" };
    return sendMessage(text, options);
  }

  async function handleWebhook(req, res) {
    if (!botToken || !webhookSecret || req.params.secret !== webhookSecret) {
      return res.status(404).json({ ok: false });
    }
    const message = req.body?.message || req.body?.edited_message;
    const text = String(message?.text || "").trim();
    const chatId = String(message?.chat?.id || "").trim();
    const messageThreadId = parseIntegerValue(message?.message_thread_id);
    if (!text || !chatId) return res.json({ ok: true });
    if (defaultChatId && chatId !== String(defaultChatId)) {
      return res.json({ ok: true, ignored: true });
    }
    const command = normalizeCommand(text);
    try {
      if (command === "start" || command === "help") {
        const lines = [
          `${projectName} bot is connected.`,
          "Available commands:",
          "/help",
          "/status",
          ...helpLines
        ];
        await sendMessage(lines.join("\n"), { chatId, messageThreadId });
      } else if (command === "status" && typeof getStatusMessage === "function") {
        await sendMessage(await getStatusMessage(), { chatId, messageThreadId });
      } else if (commandHandlers[command]) {
        const result = await commandHandlers[command]({
          req,
          res,
          text,
          chatId,
          messageThreadId,
          sendMessage: (reply, extra = {}) => sendMessage(reply, { chatId, messageThreadId, ...extra })
        });
        if (typeof result === "string" && result.trim()) {
          await sendMessage(result, { chatId, messageThreadId });
        }
      }
    } catch (error) {
      console.error(error);
    }
    return res.json({ ok: true });
  }

  return {
    notificationsEnabled,
    notify,
    sendMessage,
    handleWebhook
  };
}

module.exports = {
  createTelegramProjectBot,
  parseIntegerValue
};
