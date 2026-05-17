# selltomakemoney Telegram controller

This folder adds a simple Telegram webhook controller for **selltomakemoney.com** only. It lets you check project status, run safe Codex tasks, review logs, and confirm deploys from your approved private Telegram group.

It is intentionally project-specific and locked down:

- one project only
- one approved Telegram user ID
- one approved Telegram group chat ID
- no raw shell commands from Telegram
- secrets stay in `.env`

## What it supports

- `/start`
- `/help`
- `/status`
- `/gitstatus`
- `/codex [task description]`
- `/deploy`
- `/confirmdeploy`
- `/logs`
- `/last`
- `/cancel`

## 1. Create a Telegram bot with BotFather

1. Open Telegram and search for **BotFather**.
2. Start a chat and send:

   ```text
   /newbot
   ```

3. Follow the prompts for the bot name and username.
4. Copy the bot token BotFather gives you. Put that token into:

   ```text
   TELEGRAM_BOT_TOKEN=
   ```

## 2. Add the bot to your private Telegram group

1. Open your private group.
2. Add the bot as a member.
3. Give it permission to read and send messages if your group settings require it.
4. Keep privacy mode in mind. If needed, use BotFather:

   ```text
   /setprivacy
   ```

   Then disable privacy mode for this bot so it can read group commands.

## 3. Get your Telegram user ID

You can use a helper bot such as `@userinfobot` or `@RawDataBot`.

1. Message the helper bot.
2. It will reply with your Telegram user ID.
3. Put that value into:

   ```text
   ALLOWED_TELEGRAM_USER_ID=
   ```

## 4. Get the Telegram group chat ID

The easiest way:

1. Add `@RawDataBot` to the group.
2. Send any message in the group.
3. Read the chat ID from the raw update output.

Telegram group chat IDs usually look like a negative number, for example:

```text
-1001234567890
```

Put that value into:

```text
ALLOWED_TELEGRAM_CHAT_ID=
```

## 5. Create the `.env` file

Copy `.env.example` to `.env` inside the `telegram-bot` folder.

Example:

```text
PORT=4300
TELEGRAM_BOT_TOKEN=123456:ABCDEF
TELEGRAM_WEBHOOK_URL=https://your-domain.com
ALLOWED_TELEGRAM_USER_ID=123456789
ALLOWED_TELEGRAM_CHAT_ID=-1001234567890
PROJECT_NAME=selltomakemoney
PROJECT_ROOT=C:\Users\T470\Documents\New project 4
DEPLOY_COMMAND=railway up
```

Notes:

- `TELEGRAM_WEBHOOK_URL` should be the public base URL that will receive Telegram webhooks.
- The webhook path is created automatically by the bot using the token.
- `PROJECT_ROOT` must point to the selltomakemoney project root.
- `DEPLOY_COMMAND` should be the approved deploy command for this project only.

## 6. Install dependencies

From the `telegram-bot` folder:

```bash
npm install
```

## 7. Start the bot

From the `telegram-bot` folder:

```bash
npm start
```

If startup succeeds, the bot will:

- validate required environment variables
- verify the project root exists
- create the webhook on Telegram
- start the Express webhook server

## 8. Set the webhook

The server automatically calls Telegram `setWebhook` on startup using:

```text
${TELEGRAM_WEBHOOK_URL}/telegram/webhook/${TELEGRAM_BOT_TOKEN}
```

So in most cases, you only need to:

1. expose the server publicly
2. make sure `TELEGRAM_WEBHOOK_URL` is correct
3. start the bot

To test webhook health locally, you can also check:

```text
GET /health
```

## 9. Test commands

Send these commands from the approved user account inside the approved Telegram group:

```text
/start
/help
/status
/gitstatus
/codex improve homepage layout for simpler product discovery
/deploy
/confirmdeploy
/logs
/last
/cancel
```

## Command behavior summary

### `/status`
Returns:

- project name
- project root
- current git branch
- last commit
- bot uptime
- bot status

### `/gitstatus`
Runs `git status --short --branch` inside `PROJECT_ROOT` only.

### `/codex [task]`
Runs:

```text
codex exec -C PROJECT_ROOT -a never -s workspace-write -o <tempfile> [task]
```

The task is restricted to the approved project root only.

### `/deploy`
Does not deploy immediately. It creates a 5-minute confirmation window.

### `/confirmdeploy`
Runs the approved `DEPLOY_COMMAND` only if the same approved user requested `/deploy` within the last 5 minutes.

### `/logs`
Shows the latest 50 lines from `logs/commands.log`.

### `/last`
Shows the last stored Codex task result.

### `/cancel`
Clears any pending deploy confirmation.

## Logging

Every command and response is appended to:

```text
telegram-bot/logs/commands.log
```

The bot also stores the latest Codex task result in the logs folder so `/last` still works after a restart.

## Security notes

- The bot rejects all messages from unapproved users.
- The bot rejects all messages outside the approved Telegram group.
- It never accepts raw shell commands from Telegram.
- It never echoes `.env` secrets back to Telegram.
- Only built-in approved actions are allowed.
- Codex, git, and deploy actions all have timeout handling and clear error responses.
