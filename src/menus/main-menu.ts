import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { e, E } from "../utils/emoji";
import * as db from "../db";

export async function showMainMenu(ctx: BotContext, edit = false) {
  const channels = db.getAllChannels();
  const campaigns = db.getAllCampaigns();

  const text = [
    `${e("📊", E.PANEL)} <b>Панель управления рассылками</b>`,
    "",
    `${e("📢", E.CHANNELS)} Каналов: ${channels.length}`,
    `${e("🔗", E.CAMPAIGN)} Кампаний: ${campaigns.length}`,
  ].join("\n");

  const kb = new InlineKeyboard()
    .text(`📢 Каналы (${channels.length})`, "channels:list")
    .row()
    .text(`🔗 Кампании (${campaigns.length})`, "campaigns:list")
    .row();

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}
