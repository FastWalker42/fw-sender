import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { e, E } from "../utils/emoji";
import * as db from "../db";

export async function showChannelList(ctx: BotContext, edit = true) {
  const channels = db.getAllChannels();

  const kb = new InlineKeyboard();
  for (const ch of channels) {
    const label = ch.title || ch.username || ch.chat_id;
    kb.text(label, `ch:${ch.id}`).icon(E.CHANNELS).row();
  }
  kb.text("Добавить канал", "ch:add").icon(E.ADD).row();
  kb.text("Назад", "main").icon(E.BACK).row();

  const text = `${e("📢", E.CHANNELS)} <b>Каналы</b>\n\nВсего: ${channels.length}`;

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
  const approveStatus = channel.auto_approve ? "ВКЛ ✓" : "ВЫКЛ";
  const topicInfo = channel.message_thread_id
    ? `Топик: <code>${channel.message_thread_id}</code>`
    : "Топик: —";

  const text = [
    `${e("📢", E.CHANNELS)} <b>${label}</b>`,
    `ID: <code>${channel.chat_id}</code>`,
    channel.username ? `Username: @${channel.username}` : "",
    topicInfo,
    `Автоприём заявок: ${channel.auto_approve ? `${e("✅", E.ACTIVE)} Вкл` : `${e("🚫", E.STOPPED)} Выкл`}`,
  ]
    .filter(Boolean)
    .join("\n");

  const kb = new InlineKeyboard()
    .text(`АВТОПРИЁМ ЗАЯВОК: ${approveStatus}`, `ch:approve:${channelId}`).icon(E.ROBOT)
    .row();

  if (channel.message_thread_id) {
    kb.text("Изменить топик", `ch:topic:${channelId}`).icon(E.RENAME)
      .text("Сбросить топик", `ch:cleartopic:${channelId}`).icon(E.CANCEL)
      .row();
  } else {
    kb.text("Задать топик", `ch:topic:${channelId}`).icon(E.STAR).row();
  }

  kb.text("Удалить канал", `ch:del:${channelId}`).icon(E.DELETE)
    .row()
    .text("Назад", "channels:list").icon(E.BACK)
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
    .text("Да, удалить", `ch:confirmdel:${channelId}`).icon(E.CONFIRM)
    .text("Отмена", `ch:${channelId}`).icon(E.CANCEL)
    .row();

  await ctx.editMessageText(
    `Удалить канал <b>${label}</b>?\nОн будет отвязан от всех кампаний.`,
    { reply_markup: kb, parse_mode: "HTML" },
  );
}
