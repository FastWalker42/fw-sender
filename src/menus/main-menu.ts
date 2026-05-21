import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { e, E } from "../utils/emoji";
import * as db from "../db";
import * as userbot from "../userbot";

export async function showMainMenu(ctx: BotContext, edit = false) {
  const channels = db.getAllChannels();
  const campaigns = db.getAllCampaigns();
  const ubStatus = userbot.isLoggedIn()
    ? `${e("✅", E.ACTIVE)} Подключён`
    : `${e("🚫", E.STOPPED)} Не подключён`;

  const text = [
    `${e("📊", E.PANEL)} <b>Панель управления рассылками</b>`,
    "",
    `${e("📢", E.CHANNELS)} Каналов: ${channels.length}`,
    `${e("🔗", E.CAMPAIGN)} Кампаний: ${campaigns.length}`,
    `${e("🤖", E.ROBOT)} Юзербот: ${ubStatus}`,
  ].join("\n");

  const kb = new InlineKeyboard()
    .text(`Каналы (${channels.length})`, "channels:list").icon(E.CHANNELS)
    .row()
    .text(`Кампании (${campaigns.length})`, "campaigns:list").icon(E.CAMPAIGN)
    .row()
    .text("Юзербот", "ub:menu").icon(E.ROBOT)
    .row();

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}
