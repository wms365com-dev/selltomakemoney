import express from "express";
import dotenv from "dotenv";
import { execa } from "execa";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const requiredEnv = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_URL",
  "ALLOWED_TELEGRAM_USER_ID",
  "ALLOWED_TELEGRAM_CHAT_ID",
  "PROJECT_NAME",
  "PROJECT_ROOT",
  "DEPLOY_COMMAND"
];

const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const PORT = Number(process.env.PORT || 4300);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_URL = String(process.env.TELEGRAM_WEBHOOK_URL || "").replace(/\/$/, "");
const ALLOWED_TELEGRAM_USER_ID = String(process.env.ALLOWED_TELEGRAM_USER_ID || "").trim();
const ALLOWED_TELEGRAM_CHAT_ID = String(process.env.ALLOWED_TELEGRAM_CHAT_ID || "").trim();
const PROJECT_NAME = String(process.env.PROJECT_NAME || "selltomakemoney").trim();
const PROJECT_ROOT = path.resolve(String(process.env.PROJECT_ROOT || "").trim());
const DEPLOY_COMMAND = String(process.env.DEPLOY_COMMAND || "").trim();
const WEBHOOK_PATH = `/telegram/webhook/${TELEGRAM_BOT_TOKEN}`;

const BOT_STATUS = "online";
const DEPLOY_CONFIRM_WINDOW_MS = 5 * 60 * 1000;
const CODEX_TIMEOUT_MS = 10 * 60 * 1000;
const GIT_TIMEOUT_MS = 30 * 1000;
const DEPLOY_TIMEOUT_MS = 12 * 60 * 1000;
const LOG_DIR = path.join(process.cwd(), "logs");
const COMMAND_LOG_PATH = path.join(LOG_DIR, "commands.log");
const LAST_RESULT_PATH = path.join(LOG_DIR, "last-codex-result.json");

let pendingDeploy = null;
let activeCodexRun = null;

const app = express();
app.use(express.json({ limit: "1mb" }));

bootstrap().catch((error) => {
  console.error("Telegram bot startup failed:", error);
  process.exit(1);
});

async function bootstrap() {
  await ensureFilesystem();
  await ensureProjectRoot();
  await ensureWebhook();

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      project: PROJECT_NAME,
      status: BOT_STATUS,
      uptimeSeconds: Math.round(process.uptime())
    });
  });

  app.post(WEBHOOK_PATH, async (req, res) => {
    try {
      const handled = await handleTelegramUpdate(req.body);
      res.status(handled ? 200 : 202).json({ ok: true });
    } catch (error) {
      await logEvent({
        level: "error",
        command: "webhook",
        response: error.message || "Unhandled webhook error"
      });
      res.status(500).json({ ok: false });
    }
  });

  app.listen(PORT, () => {
    console.log(`${PROJECT_NAME} Telegram controller listening on port ${PORT}`);
  });
}

async function ensureFilesystem() {
  await fsp.mkdir(LOG_DIR, { recursive: true });
  if (!fs.existsSync(COMMAND_LOG_PATH)) {
    await fsp.writeFile(COMMAND_LOG_PATH, "", "utf8");
  }
}

async function ensureProjectRoot() {
  const stat = await fsp.stat(PROJECT_ROOT).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`PROJECT_ROOT does not exist: ${PROJECT_ROOT}`);
  }
}

async function ensureWebhook() {
  const webhookUrl = `${TELEGRAM_WEBHOOK_URL}${WEBHOOK_PATH}`;
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(`Telegram setWebhook failed: ${data.description || response.statusText}`);
  }
}

async function handleTelegramUpdate(update) {
  const message = update?.message || update?.edited_message;
  if (!message?.text) return false;

  const chatId = String(message.chat?.id || "");
  const userId = String(message.from?.id || "");
  const text = String(message.text || "").trim();

  if (!isAuthorized({ chatId, userId })) {
    await logEvent({
      level: "warn",
      userId,
      chatId,
      command: text,
      response: "Rejected unauthorized message"
    });
    return false;
  }

  const { command, args } = parseCommand(text);
  if (!command) return false;

  const context = { chatId, userId, messageId: message.message_id, command, args, text };

  try {
    switch (command) {
      case "/start":
        return respond(context, startText());
      case "/help":
        return respond(context, helpText());
      case "/status":
        return respond(context, await statusText());
      case "/gitstatus":
        return respond(context, await gitStatusText());
      case "/codex":
        return handleCodexCommand(context);
      case "/deploy":
        return handleDeployRequest(context);
      case "/confirmdeploy":
        return handleDeployConfirm(context);
      case "/logs":
        return respond(context, await latestLogsText());
      case "/last":
        return respond(context, await lastTaskText());
      case "/cancel":
        return handleCancel(context);
      default:
        return respond(context, `Unknown command for ${PROJECT_NAME}. Use /help to see the approved commands.`);
    }
  } catch (error) {
    const messageText = friendlyError(error);
    await logEvent({
      level: "error",
      userId,
      chatId,
      command: text,
      response: messageText
    });
    await sendTelegramMessage(chatId, messageText, message.message_id);
    return true;
  }
}

function isAuthorized({ chatId, userId }) {
  return chatId === ALLOWED_TELEGRAM_CHAT_ID && userId === ALLOWED_TELEGRAM_USER_ID;
}

function parseCommand(text) {
  const [rawCommand, ...rest] = text.split(/\s+/);
  if (!rawCommand.startsWith("/")) return { command: "", args: "" };
  const command = rawCommand.split("@")[0].toLowerCase();
  return { command, args: rest.join(" ").trim() };
}

async function respond(context, responseText) {
  await logEvent({
    level: "info",
    userId: context.userId,
    chatId: context.chatId,
    command: context.text,
    response: responseText
  });
  await sendTelegramMessage(context.chatId, responseText, context.messageId);
  return true;
}

function startText() {
  return [
    `${PROJECT_NAME} Telegram controller is online.`,
    "",
    "Available commands:",
    "/help",
    "/status",
    "/gitstatus",
    "/codex [task]",
    "/deploy",
    "/confirmdeploy",
    "/logs",
    "/last",
    "/cancel"
  ].join("\n");
}

function helpText() {
  return [
    `${PROJECT_NAME} command help`,
    "",
    "/start - show project name and commands",
    "/help - show this help message",
    "/status - project, git, uptime, and bot status",
    "/gitstatus - run git status inside the project only",
    "/codex improve homepage layout for faster browsing",
    "/deploy - request a deploy confirmation",
    "/confirmdeploy - confirm a pending deploy request within 5 minutes",
    "/logs - show the latest 50 command log lines",
    "/last - show the last Codex task result",
    "/cancel - cancel a pending deploy confirmation"
  ].join("\n");
}

async function statusText() {
  const [branch, lastCommit] = await Promise.all([
    runCommand("git", ["branch", "--show-current"], { timeout: GIT_TIMEOUT_MS }),
    runCommand("git", ["log", "-1", "--oneline"], { timeout: GIT_TIMEOUT_MS })
  ]);

  return [
    `Project: ${PROJECT_NAME}`,
    `Project root: ${PROJECT_ROOT}`,
    `Current git branch: ${branch.stdout.trim() || "unknown"}`,
    `Last commit: ${lastCommit.stdout.trim() || "unknown"}`,
    `Server uptime: ${formatUptime(process.uptime())}`,
    `Bot status: ${BOT_STATUS}`
  ].join("\n");
}

async function gitStatusText() {
  const result = await runCommand("git", ["status", "--short", "--branch"], { timeout: GIT_TIMEOUT_MS });
  return formatCommandBlock("git status", result.stdout || "Working tree clean.");
}

async function handleCodexCommand(context) {
  if (!context.args) {
    return respond(context, "Usage: /codex [task description]");
  }
  if (activeCodexRun) {
    return respond(context, `A Codex task is already running for ${PROJECT_NAME}. Please wait for it to finish before starting another one.`);
  }

  activeCodexRun = {
    userId: context.userId,
    startedAt: Date.now(),
    prompt: context.args
  };

  await sendTelegramMessage(context.chatId, `Running Codex for ${PROJECT_NAME}.\n\nTask: ${context.args}`, context.messageId);

  const outputFile = path.join(os.tmpdir(), `selltomakemoney-codex-${Date.now()}.txt`);
  let finalText;

  try {
    const result = await runCommand("codex", [
      "exec",
      "-C",
      PROJECT_ROOT,
      "-a",
      "never",
      "-s",
      "workspace-write",
      "-o",
      outputFile,
      context.args
    ], { timeout: CODEX_TIMEOUT_MS, cwd: PROJECT_ROOT });

    const fileText = await fsp.readFile(outputFile, "utf8").catch(() => "");
    finalText = [
      `Codex task completed for ${PROJECT_NAME}.`,
      "",
      `Task: ${context.args}`,
      "",
      "Result:",
      truncateForTelegram(fileText || result.stdout || "Codex completed without a final message.")
    ].join("\n");

    await saveLastCodexResult({
      task: context.args,
      completedAt: new Date().toISOString(),
      response: fileText || result.stdout || result.stderr || "Codex completed."
    });
  } catch (error) {
    finalText = [
      `Codex task failed for ${PROJECT_NAME}.`,
      "",
      `Task: ${context.args}`,
      "",
      friendlyError(error)
    ].join("\n");
    await saveLastCodexResult({
      task: context.args,
      completedAt: new Date().toISOString(),
      response: finalText,
      failed: true
    });
  } finally {
    activeCodexRun = null;
    await fsp.rm(outputFile, { force: true }).catch(() => {});
  }

  await logEvent({
    level: "info",
    userId: context.userId,
    chatId: context.chatId,
    command: context.text,
    response: finalText
  });
  await sendTelegramMessage(context.chatId, finalText, context.messageId);
  return true;
}

async function handleDeployRequest(context) {
  pendingDeploy = {
    userId: context.userId,
    requestedAt: Date.now(),
    expiresAt: Date.now() + DEPLOY_CONFIRM_WINDOW_MS
  };
  return respond(context, `Confirm deploy for ${PROJECT_NAME}? Reply /confirmdeploy within 5 minutes.`);
}

async function handleDeployConfirm(context) {
  if (!pendingDeploy || pendingDeploy.userId !== context.userId) {
    return respond(context, `There is no pending deploy confirmation for ${PROJECT_NAME}. Start with /deploy.`);
  }
  if (Date.now() > pendingDeploy.expiresAt) {
    pendingDeploy = null;
    return respond(context, `The deploy confirmation expired for ${PROJECT_NAME}. Send /deploy again to request a fresh confirmation.`);
  }

  pendingDeploy = null;
  await sendTelegramMessage(context.chatId, `Deploying ${PROJECT_NAME} now...`, context.messageId);

  let responseText;
  try {
    const result = await runPowerShellCommand(DEPLOY_COMMAND, {
      cwd: PROJECT_ROOT,
      timeout: DEPLOY_TIMEOUT_MS
    });
    responseText = [
      `Deploy completed for ${PROJECT_NAME}.`,
      "",
      formatCommandBlock("deploy", result.stdout || "Deploy command completed.")
    ].join("\n");
  } catch (error) {
    responseText = [
      `Deploy failed for ${PROJECT_NAME}.`,
      "",
      friendlyError(error)
    ].join("\n");
  }

  await logEvent({
    level: "info",
    userId: context.userId,
    chatId: context.chatId,
    command: context.text,
    response: responseText
  });
  await sendTelegramMessage(context.chatId, responseText, context.messageId);
  return true;
}

async function handleCancel(context) {
  pendingDeploy = null;
  return respond(context, `Pending deploy confirmation cleared for ${PROJECT_NAME}.`);
}

async function latestLogsText() {
  const contents = await fsp.readFile(COMMAND_LOG_PATH, "utf8").catch(() => "");
  const lines = contents.trim().split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-50);
  return formatCommandBlock("latest logs", tail.join("\n") || "No command logs yet.");
}

async function lastTaskText() {
  const raw = await fsp.readFile(LAST_RESULT_PATH, "utf8").catch(() => "");
  if (!raw) return "No Codex task result has been stored yet.";
  const last = JSON.parse(raw);
  return [
    `Last Codex task for ${PROJECT_NAME}`,
    `Completed: ${last.completedAt || "unknown"}`,
    `Task: ${last.task || "unknown"}`,
    "",
    truncateForTelegram(last.response || "No stored result.")
  ].join("\n");
}

async function saveLastCodexResult(payload) {
  await fsp.writeFile(LAST_RESULT_PATH, JSON.stringify(payload, null, 2), "utf8");
}

async function runCommand(command, args, options = {}) {
  return execa(command, args, {
    cwd: PROJECT_ROOT,
    timeout: options.timeout,
    reject: true,
    windowsHide: true
  });
}

async function runPowerShellCommand(commandText, options = {}) {
  return execa("powershell.exe", [
    "-NoProfile",
    "-Command",
    commandText
  ], {
    cwd: options.cwd || PROJECT_ROOT,
    timeout: options.timeout,
    reject: true,
    windowsHide: true
  });
}

function friendlyError(error) {
  const parts = [
    error.shortMessage,
    error.stderr,
    error.stdout,
    error.message
  ].filter(Boolean);
  return truncateForTelegram(parts.join("\n").trim() || "An unexpected error occurred.");
}

async function sendTelegramMessage(chatId, text, replyToMessageId) {
  const chunks = splitTelegramMessage(text);
  for (const chunk of chunks) {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        reply_to_message_id: replyToMessageId,
        disable_web_page_preview: true
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(`Telegram sendMessage failed: ${data.description || response.statusText}`);
    }
  }
}

async function logEvent({ level = "info", userId = "", chatId = "", command = "", response = "" }) {
  const line = [
    new Date().toISOString(),
    level.toUpperCase(),
    `user=${userId || "-"}`,
    `chat=${chatId || "-"}`,
    `command=${sanitizeLogSegment(command)}`,
    `response=${sanitizeLogSegment(response)}`
  ].join(" | ");
  await fsp.appendFile(COMMAND_LOG_PATH, `${line}\n`, "utf8");
}

function sanitizeLogSegment(value) {
  return String(value || "")
    .replace(/\r?\n/g, " ↩ ")
    .replace(/\s+/g, " ")
    .slice(0, 1500);
}

function truncateForTelegram(text, maxLength = 3500) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 19)}\n\n[truncated]`;
}

function splitTelegramMessage(text, maxLength = 3500) {
  const value = String(text || "");
  if (value.length <= maxLength) return [value];

  const chunks = [];
  let remaining = value;
  while (remaining.length > maxLength) {
    let index = remaining.lastIndexOf("\n", maxLength);
    if (index < maxLength * 0.6) index = remaining.lastIndexOf(" ", maxLength);
    if (index < 1) index = maxLength;
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function formatCommandBlock(label, content) {
  return `${label}\n\n${truncateForTelegram(content)}`;
}

function formatUptime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (minutes || hours || days) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}
