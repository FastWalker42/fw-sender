import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import * as db from "../db";

export async function showMainMenu(ctx: BotContext, edit = false) {
  const channels = db.getAllChannels();
  const campaigns = db.getAllCampaigns();

  const text = [
    "📋 <b>Панель управления рассылками</b>",
    "",
    `📢 Каналов: ${channels.length}`,
    `📡 Кампаний: ${campaigns.length}`,
  ].join("\n");

  const kb = new InlineKeyboard()
    .text(`📢 Каналы (${channels.length})`, "channels:list")
    .row()
    .text(`📡 Кампании (${campaigns.length})`, "campaigns:list")
    .row();

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}
