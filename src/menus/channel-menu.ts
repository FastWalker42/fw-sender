import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import * as db from "../db";

export async function showChannelList(ctx: BotContext, edit = true) {
  const channels = db.getAllChannels();

  const kb = new InlineKeyboard();
  for (const ch of channels) {
    const label = ch.title || ch.username || ch.chat_id;
    kb.text(`📢 ${label}`, `ch:${ch.id}`).row();
  }
  kb.text("➕ Добавить канал", "ch:add").row();
  kb.text("◀️ Назад", "main").row();

  const text = `📢 <b>Каналы</b>\n\nВсего: ${channels.length}`;

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function showChannelDetail(ctx: BotContext, channelId: number, edit = true) {
  const channel = db.getChannel(channelId);
  if (!channel) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery("Канал не найден");
    return;
  }

  const label = channel.title || channel.username || channel.chat_id;

  const text = [
    `📢 <b>${label}</b>`,
    `ID: <code>${channel.chat_id}</code>`,
    channel.username ? `Username: @${channel.username}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const kb = new InlineKeyboard()
    .text("🗑 Удалить канал", `ch:del:${channelId}`)
    .row()
    .text("◀️ Назад", "channels:list")
    .row();

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function showDeleteChannelConfirm(ctx: BotContext, channelId: number) {
  const channel = db.getChannel(channelId);
  if (!channel) return;
  const label = channel.title || channel.username || channel.chat_id;

  const kb = new InlineKeyboard()
    .text("✅ Да, удалить", `ch:confirmdel:${channelId}`)
    .text("❌ Отмена", `ch:${channelId}`)
    .row();

  await ctx.editMessageText(
    `Удалить канал <b>${label}</b>?\nОн будет отвязан от всех кампаний.`,
    { reply_markup: kb, parse_mode: "HTML" },
  );
}
