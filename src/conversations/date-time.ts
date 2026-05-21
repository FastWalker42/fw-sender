import { type Context, InlineKeyboard } from "grammy";
import { tgwidget, parseDate, parseSchedule } from "tgwidget";
import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../types";
import { BOT_USERNAME } from "../config";
import { e, E } from "../utils/emoji";
import * as db from "../db";
import { showCampaignDetail, showPlanPostDetail, showBroadcastGroupDetail, safeDelete } from "../menus/campaign-menu";

type Conv = Conversation<BotContext, BotContext>;

/** Cast inner conversation context to BotContext for menu helpers */
const bc = (ctx: Context) => ctx as BotContext;

/* ─────────────── Campaign Schedule ────────────────────────── */

export async function scheduleConversation(conversation: Conv, ctx: BotContext) {
  const cmpId = await conversation.external((ctx) => Number((ctx as BotContext).session.convPayload));
  if (!cmpId) return;

  const bot = BOT_USERNAME;

  const kb = new InlineKeyboard();
  if (bot) {
    const twTime = tgwidget(bot).date({ mode: "time" }).style({ liquidGlass: true, adoptTgPalette: true });
    const twSched = tgwidget(bot).schedule({ format: "single" }).style({ liquidGlass: true, adoptTgPalette: true });
    kb.webApp("Простое время", twTime.url()).icon(E.SCHEDULE).row();
    kb.webApp("Подробное расписание", twSched.url()).icon(E.FILE).row();
  }
  kb.text("Отменить", "conv:cancel").icon(E.CANCEL).row();

  await ctx.editMessageText(
    `${e("🕓", E.SCHEDULE)} <b>Выберите тип расписания</b>\n\n` +
      `Или введите время в формате <code>ЧЧ:ММ</code>`,
    { reply_markup: kb, parse_mode: "HTML" },
  );

  while (true) {
    const update = await conversation.wait();

    // Cancel button
    if (update.callbackQuery?.data === "conv:cancel") {
      await update.answerCallbackQuery();
      await showCampaignDetail(bc(update), cmpId);
      return;
    }

    // WebApp data from tgwidget
    if (update.message?.web_app_data?.data) {
      const raw = update.message.web_app_data.data;
      try {
        const parsed = parseDate(raw, { mode: "time" });
        if (parsed) {
          db.updateCampaign(cmpId, { schedule_type: "simple", schedule_value: parsed.time });
          await update.reply(`${e("✅", E.CONFIRM)} Расписание: ежедневно в ${parsed.time}`, { parse_mode: "HTML" });
          await showCampaignDetail(bc(update), cmpId, false);
          return;
        }
      } catch { /* not a time, try schedule */ }
      try {
        const parsed = parseSchedule(raw, { format: "single" });
        if (parsed) {
          db.updateCampaign(cmpId, { schedule_type: "detailed", schedule_value: raw });
          await update.reply(`${e("✅", E.CONFIRM)} Подробное расписание обновлено.`, { parse_mode: "HTML" });
          await showCampaignDetail(bc(update), cmpId, false);
          return;
        }
      } catch { /* ignore */ }
    }

    // /start with tgwidget payload
    if (update.message?.text?.startsWith("/start ")) {
      const payload = update.message.text.slice(7);
      try {
        const parsed = parseDate(payload, { mode: "time" });
        if (parsed) {
          db.updateCampaign(cmpId, { schedule_type: "simple", schedule_value: parsed.time });
          await update.reply(`${e("✅", E.CONFIRM)} Расписание: ежедневно в ${parsed.time}`, { parse_mode: "HTML" });
          await showCampaignDetail(bc(update), cmpId, false);
          return;
        }
      } catch { /* try schedule */ }
      try {
        const parsed = parseSchedule(payload, { format: "single" });
        if (parsed) {
          db.updateCampaign(cmpId, { schedule_type: "detailed", schedule_value: payload });
          await update.reply(`${e("✅", E.CONFIRM)} Подробное расписание обновлено.`, { parse_mode: "HTML" });
          await showCampaignDetail(bc(update), cmpId, false);
          return;
        }
      } catch { /* ignore */ }
    }

    // Manual text input (HH:MM)
    if (update.message?.text) {
      const text = update.message.text.trim();
      const m = text.match(/^(\d{1,2}):(\d{2})$/);
      if (m?.[1] && m[2]) {
        const time = `${m[1].padStart(2, "0")}:${m[2]}`;
        db.updateCampaign(cmpId, { schedule_type: "simple", schedule_value: time });
        await update.reply(`${e("✅", E.CONFIRM)} Расписание: ежедневно в ${time}`, { parse_mode: "HTML" });
        await showCampaignDetail(bc(update), cmpId, false);
        return;
      }
      await update.reply(`${e("⚠️", E.WARNING)} Формат: ЧЧ:ММ (например 09:30)`, { parse_mode: "HTML" });
    }
  }
}

/* ─────────────── Campaign Default Time ───────────────────── */

export async function defaultTimeConversation(conversation: Conv, ctx: BotContext) {
  const cmpId = await conversation.external((ctx) => Number((ctx as BotContext).session.convPayload));
  if (!cmpId) return;

  const bot = BOT_USERNAME;
  const widget = bot ? tgwidget(bot).date({ mode: "time" }).style({ liquidGlass: true, adoptTgPalette: true }) : null;

  const kb = new InlineKeyboard();
  if (widget) {
    kb.webApp("Выбрать время", widget.url()).icon(E.SCHEDULE).row();
  }
  kb.text("Отменить", "conv:cancel").icon(E.CANCEL).row();

  const pattern = widget?.pattern || "ЧЧ:ММ";
  await ctx.editMessageText(
    `${e("🕓", E.SCHEDULE)} <b>Дефолт-время для плана постов</b>\n\n` +
      `Введите время в формате <code>${pattern}</code> или выберите через виджет:`,
    { reply_markup: kb, parse_mode: "HTML" },
  );

  while (true) {
    const update = await conversation.wait();

    if (update.callbackQuery?.data === "conv:cancel") {
      await update.answerCallbackQuery();
      await showCampaignDetail(bc(update), cmpId);
      return;
    }

    // WebApp data
    if (update.message?.web_app_data?.data) {
      try {
        const parsed = widget ? widget.parse(update.message.web_app_data.data) : parseDate(update.message.web_app_data.data, { mode: "time" });
        if (parsed && parsed.time) {
          db.updateCampaign(cmpId, { default_time: parsed.time });
          await update.reply(`${e("✅", E.CONFIRM)} Дефолт-время: ${parsed.time}`, { parse_mode: "HTML" });
          await showCampaignDetail(bc(update), cmpId, false);
          return;
        }
      } catch { /* ignore */ }
    }

    // /start payload
    if (update.message?.text?.startsWith("/start ")) {
      try {
        const parsed = widget ? widget.parse(update.message.text) : parseDate(update.message.text.slice(7), { mode: "time" });
        if (parsed && parsed.time) {
          db.updateCampaign(cmpId, { default_time: parsed.time });
          await update.reply(`${e("✅", E.CONFIRM)} Дефолт-время: ${parsed.time}`, { parse_mode: "HTML" });
          await showCampaignDetail(bc(update), cmpId, false);
          return;
        }
      } catch { /* ignore */ }
    }

    // Manual text
    if (update.message?.text) {
      const m = update.message.text.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (m?.[1] && m[2]) {
        const time = `${m[1].padStart(2, "0")}:${m[2]}`;
        db.updateCampaign(cmpId, { default_time: time });
        await update.reply(`${e("✅", E.CONFIRM)} Дефолт-время: ${time}`, { parse_mode: "HTML" });
        await showCampaignDetail(bc(update), cmpId, false);
        return;
      }
      await update.reply(`${e("⚠️", E.WARNING)} Формат: ЧЧ:ММ`, { parse_mode: "HTML" });
    }
  }
}

/* ─────────────── Plan Post Date/Time ─────────────────────── */

export async function planDatetimeConversation(conversation: Conv, ctx: BotContext) {
  const postId = await conversation.external((ctx) => Number((ctx as BotContext).session.convPayload));
  if (!postId) return;

  const post = db.getPlanPost(postId);
  if (!post) return;

  const bot = BOT_USERNAME;
  const widget = bot ? tgwidget(bot).date({ mode: "datetime" }).style({ liquidGlass: true, adoptTgPalette: true }) : null;

  const kb = new InlineKeyboard();
  if (widget) {
    kb.webApp("Дата и время", widget.url()).icon(E.SCHEDULE).row();
  }
  kb.text("АВТО", "conv:auto").icon(E.ROBOT).row();
  kb.text("Отменить", "conv:cancel").icon(E.CANCEL).row();

  const pattern = widget?.pattern || "ГГГГ-ММ-ДД ЧЧ:ММ";
  await ctx.editMessageText(
    `${e("🕓", E.SCHEDULE)} <b>Дата и время отправки</b>\n\n` +
      `Введите в формате <code>${pattern}</code>, нажмите АВТО или выберите через виджет:`,
    { reply_markup: kb, parse_mode: "HTML" },
  );

  while (true) {
    const update = await conversation.wait();

    if (update.callbackQuery?.data === "conv:cancel") {
      await update.answerCallbackQuery();
      await safeDelete(bc(update).api, bc(update).chat!.id, update.callbackQuery.message!.message_id);
      await showPlanPostDetail(bc(update), postId);
      return;
    }

    if (update.callbackQuery?.data === "conv:auto") {
      await update.answerCallbackQuery();
      const cmp = db.getCampaign(post.campaign_id);
      db.updatePlanPost(postId, { is_auto_time: 1, send_time: cmp?.default_time || "12:00" });
      await safeDelete(bc(update).api, bc(update).chat!.id, update.callbackQuery.message!.message_id);
      await showPlanPostDetail(bc(update), postId);
      return;
    }

    // WebApp data
    if (update.message?.web_app_data?.data) {
      try {
        const parsed = widget ? widget.parse(update.message.web_app_data.data) : parseDate(update.message.web_app_data.data, { mode: "datetime" });
        if (parsed) {
          const updates: Record<string, string | number | null> = { is_auto_time: 0 };
          if (parsed.date) updates.send_date = parsed.date;
          if (parsed.time) updates.send_time = parsed.time;
          db.updatePlanPost(postId, updates);
          await showPlanPostDetail(bc(update), postId);
          return;
        }
      } catch { /* ignore */ }
    }

    // /start payload
    if (update.message?.text?.startsWith("/start ")) {
      try {
        const parsed = widget ? widget.parse(update.message.text) : parseDate(update.message.text.slice(7), { mode: "datetime" });
        if (parsed) {
          const updates: Record<string, string | number | null> = { is_auto_time: 0 };
          if (parsed.date) updates.send_date = parsed.date;
          if (parsed.time) updates.send_time = parsed.time;
          db.updatePlanPost(postId, updates);
          await showPlanPostDetail(bc(update), postId);
          return;
        }
      } catch { /* ignore */ }
    }

    // Manual text: YYYY-MM-DD HH:MM or YYYY-MM-DD_HH-MM
    if (update.message?.text) {
      const text = update.message.text.trim();
      // Try datetime
      const dtMatch = text.match(/^(\d{4}-\d{2}-\d{2})[_ ](\d{1,2})[:-](\d{2})$/);
      if (dtMatch?.[1] && dtMatch[2] && dtMatch[3]) {
        const date = dtMatch[1];
        const time = `${dtMatch[2].padStart(2, "0")}:${dtMatch[3]}`;
        db.updatePlanPost(postId, { send_date: date, send_time: time, is_auto_time: 0 });
        await showPlanPostDetail(bc(update), postId);
        return;
      }
      // Try date only
      const dateMatch = text.match(/^(\d{4}-\d{2}-\d{2})$/);
      if (dateMatch?.[1]) {
        db.updatePlanPost(postId, { send_date: dateMatch[1], is_auto_time: 0 });
        await showPlanPostDetail(bc(update), postId);
        return;
      }
      // Try time only
      const timeMatch = text.match(/^(\d{1,2}):(\d{2})$/);
      if (timeMatch?.[1] && timeMatch[2]) {
        const time = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
        db.updatePlanPost(postId, { send_time: time, is_auto_time: 0 });
        await showPlanPostDetail(bc(update), postId);
        return;
      }
      await update.reply(
        `${e("⚠️", E.WARNING)} Формат: <code>${pattern}</code> или <code>ЧЧ:ММ</code> или <code>ГГГГ-ММ-ДД</code>`,
        { parse_mode: "HTML" },
      );
    }
  }
}

/* ─────────────── Broadcast Group Time ────────────────────── */

export async function broadcastGroupTimeConversation(conversation: Conv, ctx: BotContext) {
  const groupId = await conversation.external((ctx) => Number((ctx as BotContext).session.convPayload));
  if (!groupId) return;

  const group = db.getBroadcastGroup(groupId);
  if (!group) return;

  const bot = BOT_USERNAME;

  const kb = new InlineKeyboard();
  if (bot) {
    const twTime = tgwidget(bot).date({ mode: "time" }).style({ liquidGlass: true, adoptTgPalette: true });
    const twSched = tgwidget(bot).schedule({ format: "single" }).style({ liquidGlass: true, adoptTgPalette: true });
    kb.webApp("Простое время", twTime.url()).icon(E.SCHEDULE).row();
    kb.webApp("Расписание по дням", twSched.url()).icon(E.FILE).row();
  }
  kb.text("Отменить", "conv:cancel").icon(E.CANCEL).row();

  await ctx.editMessageText(
    `${e("🕓", E.SCHEDULE)} <b>Изменить время группы «${group.label}»</b>\n\n` +
      `Текущее: ${group.schedule_type === "detailed" ? "расписание по дням" : group.send_time + " ежедневно"}\n\n` +
      `Выберите виджет или введите время в формате <code>ЧЧ:ММ</code>`,
    { reply_markup: kb, parse_mode: "HTML" },
  );

  while (true) {
    const update = await conversation.wait();

    // Cancel button
    if (update.callbackQuery?.data === "conv:cancel") {
      await update.answerCallbackQuery();
      await showBroadcastGroupDetail(bc(update), groupId);
      return;
    }

    // WebApp data from tgwidget
    if (update.message?.web_app_data?.data) {
      const raw = update.message.web_app_data.data;
      // Try time first
      try {
        const parsed = parseDate(raw, { mode: "time" });
        if (parsed) {
          db.updateBroadcastGroup(groupId, { schedule_type: "simple", schedule_value: "", send_time: parsed.time });
          await update.reply(`${e("✅", E.CONFIRM)} Время: ежедневно в ${parsed.time}`, { parse_mode: "HTML" });
          await showBroadcastGroupDetail(bc(update), groupId);
          return;
        }
      } catch { /* not a time, try schedule */ }
      // Try schedule
      try {
        const parsed = parseSchedule(raw, { format: "single" });
        if (parsed) {
          db.updateBroadcastGroup(groupId, { schedule_type: "detailed", schedule_value: raw });
          await update.reply(`${e("✅", E.CONFIRM)} Расписание по дням обновлено.`, { parse_mode: "HTML" });
          await showBroadcastGroupDetail(bc(update), groupId);
          return;
        }
      } catch { /* ignore */ }
    }

    // /start with tgwidget payload
    if (update.message?.text?.startsWith("/start ")) {
      const payload = update.message.text.slice(7);
      try {
        const parsed = parseDate(payload, { mode: "time" });
        if (parsed) {
          db.updateBroadcastGroup(groupId, { schedule_type: "simple", schedule_value: "", send_time: parsed.time });
          await update.reply(`${e("✅", E.CONFIRM)} Время: ежедневно в ${parsed.time}`, { parse_mode: "HTML" });
          await showBroadcastGroupDetail(bc(update), groupId);
          return;
        }
      } catch { /* try schedule */ }
      try {
        const parsed = parseSchedule(payload, { format: "single" });
        if (parsed) {
          db.updateBroadcastGroup(groupId, { schedule_type: "detailed", schedule_value: payload });
          await update.reply(`${e("✅", E.CONFIRM)} Расписание по дням обновлено.`, { parse_mode: "HTML" });
          await showBroadcastGroupDetail(bc(update), groupId);
          return;
        }
      } catch { /* ignore */ }
    }

    // Manual text input (HH:MM)
    if (update.message?.text) {
      const text = update.message.text.trim();
      const m = text.match(/^(\d{1,2}):(\d{2})$/);
      if (m?.[1] && m[2]) {
        const time = `${m[1].padStart(2, "0")}:${m[2]}`;
        db.updateBroadcastGroup(groupId, { schedule_type: "simple", schedule_value: "", send_time: time });
        await update.reply(`${e("✅", E.CONFIRM)} Время: ежедневно в ${time}`, { parse_mode: "HTML" });
        await showBroadcastGroupDetail(bc(update), groupId);
        return;
      }
      await update.reply(`${e("⚠️", E.WARNING)} Формат: ЧЧ:ММ (например 09:30)`, { parse_mode: "HTML" });
    }
  }
}
