import { Bot, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import type { BotContext, SessionData } from "./types";
import { BOT_TOKEN } from "./config";
import { initDb } from "./db";
import { handleStart } from "./handlers/start";
import { handleCallback } from "./handlers/callbacks";
import { handleMessage } from "./handlers/messages";
import { adminOnly } from "./utils/admin";
import { startScheduler, stopScheduler } from "./scheduler";
import { initUserbot } from "./userbot";
import {
  scheduleConversation,
  defaultTimeConversation,
  planDatetimeConversation,
} from "./conversations/date-time";

// Init database
initDb();
console.log("[db] initialized");

// Init userbot (non-blocking)
initUserbot().catch((err) => console.error("[userbot] init error:", err));

// Create bot
const bot = new Bot<BotContext>(BOT_TOKEN);

// Session
bot.use(
  session({
    initial: (): SessionData => ({}),
  }),
);

// Conversations plugin
bot.use(conversations());
bot.use(createConversation(scheduleConversation));
bot.use(createConversation(defaultTimeConversation));
bot.use(createConversation(planDatetimeConversation));

// Ignore channel_post updates — the bot must not react to posts in managed channels
bot.on("channel_post", () => {});

// Admin guard for all remaining handlers
bot.use(adminOnly);

// Commands
bot.command("start", handleStart);
bot.command("menu", handleStart);

// Callbacks
bot.on("callback_query:data", handleCallback);

// Messages (for awaiting input: channel add, post add, etc.)
bot.on("message", handleMessage);

// Error handler
bot.catch((err) => {
  console.error("[bot] error:", err);
});

// Start
bot.start({
  onStart: (info) => {
    console.log(`[bot] @${info.username} started`);
    startScheduler(bot.api);
  },
});

// Graceful shutdown
const shutdown = () => {
  console.log("[bot] shutting down...");
  stopScheduler();
  bot.stop();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
