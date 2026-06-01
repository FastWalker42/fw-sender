import { Bot, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import type { BotContext, SessionData } from "./types";
import { BOT_TOKEN, ADMIN_IDS } from "./config";
import { initDb } from "./db";
import * as db from "./db";
import { handleStart } from "./handlers/start";
import { handleCallback } from "./handlers/callbacks";
import { handleMessage } from "./handlers/messages";
import { adminOnly } from "./utils/admin";
import { startScheduler, stopScheduler } from "./scheduler";
import { initUserbot, setBotInfo } from "./userbot";
import {
  scheduleConversation,
  defaultTimeConversation,
  planDatetimeConversation,
  broadcastGroupTimeConversation,
  broadcastGroupIntervalConversation,
  planPostIntervalConversation,
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
bot.use(createConversation(broadcastGroupTimeConversation));
bot.use(createConversation(broadcastGroupIntervalConversation));
bot.use(createConversation(planPostIntervalConversation));

// Ignore channel_post updates — the bot must not react to posts in managed channels
bot.on("channel_post", () => {});

// Auto-approve join requests for channels with auto_approve enabled
bot.on("chat_join_request", async (ctx) => {
  const chatId = String(ctx.chatJoinRequest.chat.id);
  const channel = db.getChannelByChatId(chatId);
  if (channel?.auto_approve) {
    try {
      await ctx.approveChatJoinRequest(ctx.chatJoinRequest.from.id);
      console.log(`[auto-approve] approved ${ctx.chatJoinRequest.from.id} for channel ${chatId}`);
    } catch (err) {
      console.error(`[auto-approve] failed for ${ctx.chatJoinRequest.from.id} in ${chatId}:`, err);
    }
  }
});

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
  allowed_updates: ["message", "callback_query", "channel_post", "chat_join_request"],
  onStart: (info) => {
    console.log(`[bot] @${info.username} started`);
    if (info.username) setBotInfo(info.username);
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
