import { type Context, InlineKeyboard } from "grammy";
import { tgwidget, parseDate, parseSchedule } from "tgwidget";
import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../types";
import { BOT_USERNAME } from "../config";
import { e, E } from "../utils/emoji";
import * as db from "../db";
import { showCampaignDetail, showPlanPostDetail, showBroadcastGroupDetail, safeDelete } from "../menus/campaign-menu";
import { formatGroupSchedule, formatIntervalSchedule, formatPlanPostInterval } from "../utils/schedule";

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
      // Try schedule first (28-char string is unambiguous)
      try {
        const parsed = parseSchedule(raw, { format: "single" });
        if (parsed) {
          db.updateCampaign(cmpId, { schedule_type: "detailed", schedule_value: raw });
          await update.reply(`${e("✅", E.CONFIRM)} Подробное расписание обновлено.`, { parse_mode: "HTML" });
          await showCampaignDetail(bc(update), cmpId, false);
          return;
        }
      } catch { /* not a schedule, try time */ }
      try {
        const parsed = parseDate(raw, { mode: "time" });
        if (parsed && parsed.time) {
          db.updateCampaign(cmpId, { schedule_type: "simple", schedule_value: parsed.time });
          await update.reply(`${e("✅", E.CONFIRM)} Расписание: ежедневно в ${parsed.time}`, { parse_mode: "HTML" });
          await showCampaignDetail(bc(update), cmpId, false);
          return;
        }
      } catch { /* ignore */ }
    }

    // /start with tgwidget payload
    if (update.message?.text?.startsWith("/start ")) {
      const payload = update.message.text.slice(7);
      // Try schedule first
      try {
        const parsed = parseSchedule(payload, { format: "single" });
        if (parsed) {
          db.updateCampaign(cmpId, { schedule_type: "detailed", schedule_value: payload });
          await update.reply(`${e("✅", E.CONFIRM)} Подробное расписание обновлено.`, { parse_mode: "HTML" });
          await showCampaignDetail(bc(update), cmpId, false);
          return;
        }
      } catch { /* try time */ }
      try {
        const parsed = parseDate(payload, { mode: "time" });
        if (parsed && parsed.time) {
          db.updateCampaign(cmpId, { schedule_type: "simple", schedule_value: parsed.time });
          await update.reply(`${e("✅", E.CONFIRM)} Расписание: ежедневно в ${parsed.time}`, { parse_mode: "HTML" });
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
      `Текущее: ${formatGroupSchedule(group)}\n\n` +
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
      // Try schedule first (28-char string is unambiguous)
      try {
        const parsed = parseSchedule(raw, { format: "single" });
        if (parsed) {
          db.updateBroadcastGroup(groupId, { schedule_type: "detailed", schedule_value: raw });
          await update.reply(`${e("✅", E.CONFIRM)} Расписание по дням обновлено.`, { parse_mode: "HTML" });
          await showBroadcastGroupDetail(bc(update), groupId);
          return;
        }
      } catch { /* not a schedule, try time */ }
      // Try time
      try {
        const parsed = parseDate(raw, { mode: "time" });
        if (parsed && parsed.time) {
          db.updateBroadcastGroup(groupId, { schedule_type: "simple", schedule_value: "", send_time: parsed.time });
          await update.reply(`${e("✅", E.CONFIRM)} Время: ежедневно в ${parsed.time}`, { parse_mode: "HTML" });
          await showBroadcastGroupDetail(bc(update), groupId);
          return;
        }
      } catch { /* ignore */ }
    }

    // /start with tgwidget payload
    if (update.message?.text?.startsWith("/start ")) {
      const payload = update.message.text.slice(7);
      // Try schedule first
      try {
        const parsed = parseSchedule(payload, { format: "single" });
        if (parsed) {
          db.updateBroadcastGroup(groupId, { schedule_type: "detailed", schedule_value: payload });
          await update.reply(`${e("✅", E.CONFIRM)} Расписание по дням обновлено.`, { parse_mode: "HTML" });
          await showBroadcastGroupDetail(bc(update), groupId);
          return;
        }
      } catch { /* try time */ }
      try {
        const parsed = parseDate(payload, { mode: "time" });
        if (parsed && parsed.time) {
          db.updateBroadcastGroup(groupId, { schedule_type: "simple", schedule_value: "", send_time: parsed.time });
          await update.reply(`${e("✅", E.CONFIRM)} Время: ежедневно в ${parsed.time}`, { parse_mode: "HTML" });
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

/* ─────────────── Broadcast Group Interval ────────────────── */

export async function broadcastGroupIntervalConversation(conversation: Conv, ctx: BotContext) {
  const groupId = await conversation.external((ctx) => Number((ctx as BotContext).session.convPayload));
  if (!groupId) return;

  const group = db.getBroadcastGroup(groupId);
  if (!group) return;

  const bot = BOT_USERNAME;

  // Step 1: Choose interval type (simple time-range or detailed schedule with range)
  const kb1 = new InlineKeyboard();
  if (bot) {
    const twRange = tgwidget(bot).date({ mode: "time-range" }).style({ liquidGlass: true, adoptTgPalette: true });
    const twSchedRange = tgwidget(bot).schedule({ format: "range" }).style({ liquidGlass: true, adoptTgPalette: true });
    kb1.webApp("Временной диапазон", twRange.url()).icon(E.SCHEDULE).row();
    kb1.webApp("Расписание с окнами", twSchedRange.url()).icon(E.FILE).row();
  }
  kb1.text("Сбросить интервал", "conv:reset_interval").icon(E.CANCEL).row();
  kb1.text("Отменить", "conv:cancel").icon(E.CANCEL).row();

  const currentInterval = group.interval_minutes > 0
    ? `\n\nТекущий: ${formatIntervalSchedule(group)}`
    : "";

  await ctx.editMessageText(
    `${e("🕓", E.SCHEDULE)} <b>Интервальная отправка для «${group.label}»</b>\n\n` +
      `Посты будут отправляться многократно в указанном диапазоне с заданным интервалом.${currentInterval}\n\n` +
      `Выберите тип интервала или введите диапазон вручную <code>ЧЧ:ММ–ЧЧ:ММ</code>:`,
    { reply_markup: kb1, parse_mode: "HTML" },
  );

  let intervalMinutes = 0;
  let startTime: string | null = null;
  let endTime: string | null = null;
  let scheduleType: "simple" | "detailed" | null = null;
  let scheduleValue = "";

  // Phase 1: Get time range / schedule
  while (true) {
    const update = await conversation.wait();

    if (update.callbackQuery?.data === "conv:cancel") {
      await update.answerCallbackQuery();
      await showBroadcastGroupDetail(bc(update), groupId);
      return;
    }

    if (update.callbackQuery?.data === "conv:reset_interval") {
      await update.answerCallbackQuery();
      db.updateBroadcastGroup(groupId, { interval_minutes: 0, interval_end: null });
      await update.reply(`${e("✅", E.CONFIRM)} Интервал сброшен.`, { parse_mode: "HTML" });
      await showBroadcastGroupDetail(bc(update), groupId);
      return;
    }

    // WebApp data
    if (update.message?.web_app_data?.data) {
      const raw = update.message.web_app_data.data;

      // Try range schedule (56-char)
      try {
        const parsed = parseSchedule(raw, { format: "range" });
        if (parsed && parsed.some((d) => d.enabled && d.start && d.end)) {
          scheduleType = "detailed";
          scheduleValue = raw;
          // Ask for interval minutes
          break;
        }
      } catch { /* not a range schedule */ }

      // Try single schedule (28-char)
      try {
        const parsed = parseSchedule(raw, { format: "single" });
        if (parsed && parsed.some((d) => d.enabled && d.time)) {
          scheduleType = "detailed";
          scheduleValue = raw;
          // Ask for interval end + minutes
          break;
        }
      } catch { /* not a schedule */ }

      // Try time-range
      try {
        const parsed = parseDate(raw, { mode: "time-range" });
        if (parsed && parsed.time && parsed.timeEnd) {
          startTime = parsed.time;
          endTime = parsed.timeEnd;
          scheduleType = "simple";
          break;
        }
      } catch { /* not a time-range */ }
    }

    // /start payload
    if (update.message?.text?.startsWith("/start ")) {
      const payload = update.message.text.slice(7);
      try {
        const parsed = parseSchedule(payload, { format: "range" });
        if (parsed && parsed.some((d) => d.enabled && d.start && d.end)) {
          scheduleType = "detailed";
          scheduleValue = payload;
          break;
        }
      } catch { /* not a range schedule */ }
      try {
        const parsed = parseSchedule(payload, { format: "single" });
        if (parsed && parsed.some((d) => d.enabled && d.time)) {
          scheduleType = "detailed";
          scheduleValue = payload;
          break;
        }
      } catch { /* not a schedule */ }
      try {
        const parsed = parseDate(payload, { mode: "time-range" });
        if (parsed && parsed.time && parsed.timeEnd) {
          startTime = parsed.time;
          endTime = parsed.timeEnd;
          scheduleType = "simple";
          break;
        }
      } catch { /* not a time-range */ }
    }

    // Manual text: HH:MM-HH:MM or HH:MM – HH:MM
    if (update.message?.text) {
      const text = update.message.text.trim();
      const rangeMatch = text.match(/^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/);
      if (rangeMatch?.[1] && rangeMatch[2] && rangeMatch[3] && rangeMatch[4]) {
        startTime = `${rangeMatch[1].padStart(2, "0")}:${rangeMatch[2]}`;
        endTime = `${rangeMatch[3].padStart(2, "0")}:${rangeMatch[4]}`;
        scheduleType = "simple";
        break;
      }
      await update.reply(
        `${e("⚠️", E.WARNING)} Формат: <code>ЧЧ:ММ–ЧЧ:ММ</code> (например 09:00–18:00) или выберите через виджет`,
        { parse_mode: "HTML" },
      );
    }
  }

  // Phase 2: Ask for interval in minutes
  const kb2 = new InlineKeyboard();
  const presets = [5, 10, 15, 20, 30, 45, 60, 90, 120];
  for (let i = 0; i < presets.length; i++) {
    const label = presets[i]! >= 60 ? `${presets[i]! / 60} ч.` : `${presets[i]} мин.`;
    kb2.text(label, `conv:interval:${presets[i]}`);
    if (i === 2 || i === 5 || i === 8) kb2.row();
  }
  kb2.row();
  kb2.text("Отменить", "conv:cancel").icon(E.CANCEL).row();

  const rangeDesc = scheduleType === "simple" && startTime && endTime
    ? `${startTime}–${endTime}`
    : scheduleType === "detailed"
      ? "расписание по дням"
      : "";

  await ctx.reply(
    `${e("🕓", E.SCHEDULE)} <b>Интервал отправки</b>\n\n` +
      `Диапазон: ${rangeDesc}\n\n` +
      `Выберите интервал или введите количество минут:`,
    { reply_markup: kb2, parse_mode: "HTML" },
  );

  // Phase 3: Get interval minutes
  while (true) {
    const update = await conversation.wait();

    if (update.callbackQuery?.data === "conv:cancel") {
      await update.answerCallbackQuery();
      await showBroadcastGroupDetail(bc(update), groupId);
      return;
    }

    if (update.callbackQuery?.data?.startsWith("conv:interval:")) {
      await update.answerCallbackQuery();
      intervalMinutes = parseInt(update.callbackQuery.data.split(":")[2]!, 10);
      break;
    }

    if (update.message?.text) {
      const text = update.message.text.trim();
      if (/^\d+$/.test(text) && parseInt(text) >= 1) {
        intervalMinutes = parseInt(text);
        break;
      }
      await update.reply(`${e("⚠️", E.WARNING)} Введите число минут (≥ 1)`, { parse_mode: "HTML" });
    }
  }

  // Phase 4: Save
  if (scheduleType === "simple" && startTime && endTime) {
    db.updateBroadcastGroup(groupId, {
      schedule_type: "simple",
      schedule_value: "",
      send_time: startTime,
      interval_minutes: intervalMinutes,
      interval_end: endTime,
    });
  } else if (scheduleType === "detailed" && scheduleValue) {
    // For 56-char range schedule, each day already has start/end built in
    // For 28-char single schedule, we need interval_end from the user
    const isRange = scheduleValue.length === 56;
    if (isRange) {
      db.updateBroadcastGroup(groupId, {
        schedule_type: "detailed",
        schedule_value: scheduleValue,
        interval_minutes: intervalMinutes,
        interval_end: null, // start/end per day from schedule_value
      });
    } else {
      // Single schedule: need interval_end for the end time
      // Use the start time from first enabled day as send_time, need interval_end
      const kbEnd = new InlineKeyboard();
      if (bot) {
        const twEnd = tgwidget(bot).date({ mode: "time" }).style({ liquidGlass: true, adoptTgPalette: true });
        kbEnd.webApp("Конечное время", twEnd.url()).icon(E.SCHEDULE).row();
      }
      kbEnd.text("Отменить", "conv:cancel").icon(E.CANCEL).row();

      await ctx.reply(
        `${e("🕓", E.SCHEDULE)} <b>Конечное время интервала</b>\n\n` +
          `Начальное время берётся из расписания. Введите конечное время <code>ЧЧ:ММ</code>:`,
        { reply_markup: kbEnd, parse_mode: "HTML" },
      );

      let intervalEnd: string | null = null;
      while (true) {
        const update = await conversation.wait();

        if (update.callbackQuery?.data === "conv:cancel") {
          await update.answerCallbackQuery();
          await showBroadcastGroupDetail(bc(update), groupId);
          return;
        }

        if (update.message?.web_app_data?.data) {
          try {
            const parsed = parseDate(update.message.web_app_data.data, { mode: "time" });
            if (parsed?.time) {
              intervalEnd = parsed.time;
              break;
            }
          } catch { /* ignore */ }
        }

        if (update.message?.text?.startsWith("/start ")) {
          try {
            const parsed = parseDate(update.message.text.slice(7), { mode: "time" });
            if (parsed?.time) {
              intervalEnd = parsed.time;
              break;
            }
          } catch { /* ignore */ }
        }

        if (update.message?.text) {
          const m = update.message.text.trim().match(/^(\d{1,2}):(\d{2})$/);
          if (m?.[1] && m[2]) {
            intervalEnd = `${m[1].padStart(2, "0")}:${m[2]}`;
            break;
          }
          await update.reply(`${e("⚠️", E.WARNING)} Формат: ЧЧ:ММ`, { parse_mode: "HTML" });
        }
      }

      db.updateBroadcastGroup(groupId, {
        schedule_type: "detailed",
        schedule_value: scheduleValue,
        interval_minutes: intervalMinutes,
        interval_end: intervalEnd,
      });
    }
  }

  const updated = db.getBroadcastGroup(groupId);
  await ctx.reply(
    `${e("✅", E.CONFIRM)} Интервал установлен: ${updated ? formatIntervalSchedule(updated) : `каждые ${intervalMinutes} мин.`}`,
    { parse_mode: "HTML" },
  );
  await showBroadcastGroupDetail(bc(ctx), groupId);
}

/* ─────────────── Plan Post Interval ──────────────────────── */

export async function planPostIntervalConversation(conversation: Conv, ctx: BotContext) {
  const postId = await conversation.external((ctx) => Number((ctx as BotContext).session.convPayload));
  if (!postId) return;

  const post = db.getPlanPost(postId);
  if (!post) return;

  const bot = BOT_USERNAME;

  // Step 1: Get time range for interval
  const kb1 = new InlineKeyboard();
  if (bot) {
    const twRange = tgwidget(bot).date({ mode: "time-range" }).style({ liquidGlass: true, adoptTgPalette: true });
    kb1.webApp("Временной диапазон", twRange.url()).icon(E.SCHEDULE).row();
  }
  kb1.text("Сбросить интервал", "conv:reset_interval").icon(E.CANCEL).row();
  kb1.text("Отменить", "conv:cancel").icon(E.CANCEL).row();

  const currentInterval = post.interval_minutes > 0
    ? `\n\nТекущий: ${formatPlanPostInterval(post.interval_minutes, post.interval_end_time, post.interval_sent_count)}`
    : "";

  await ctx.editMessageText(
    `${e("🕓", E.SCHEDULE)} <b>Интервальная отправка для «${post.label}»</b>\n\n` +
      `Пост будет отправляться многократно в указанном диапазоне с заданным интервалом.${currentInterval}\n\n` +
      `Выберите диапазон через виджет или введите <code>ЧЧ:ММ–ЧЧ:ММ</code>:`,
    { reply_markup: kb1, parse_mode: "HTML" },
  );

  let startTime: string | null = null;
  let endTime: string | null = null;

  // Phase 1: Get time range
  while (true) {
    const update = await conversation.wait();

    if (update.callbackQuery?.data === "conv:cancel") {
      await update.answerCallbackQuery();
      await showPlanPostDetail(bc(update), postId);
      return;
    }

    if (update.callbackQuery?.data === "conv:reset_interval") {
      await update.answerCallbackQuery();
      db.updatePlanPost(postId, { interval_minutes: 0, interval_end_time: null, interval_sent_count: 0 });
      await update.reply(`${e("✅", E.CONFIRM)} Интервал сброшен.`, { parse_mode: "HTML" });
      await showPlanPostDetail(bc(update), postId);
      return;
    }

    // WebApp data
    if (update.message?.web_app_data?.data) {
      try {
        const parsed = parseDate(update.message.web_app_data.data, { mode: "time-range" });
        if (parsed && parsed.time && parsed.timeEnd) {
          startTime = parsed.time;
          endTime = parsed.timeEnd;
          break;
        }
      } catch { /* not a time-range */ }
    }

    // /start payload
    if (update.message?.text?.startsWith("/start ")) {
      try {
        const parsed = parseDate(update.message.text.slice(7), { mode: "time-range" });
        if (parsed && parsed.time && parsed.timeEnd) {
          startTime = parsed.time;
          endTime = parsed.timeEnd;
          break;
        }
      } catch { /* not a time-range */ }
    }

    // Manual text: HH:MM-HH:MM
    if (update.message?.text) {
      const text = update.message.text.trim();
      const rangeMatch = text.match(/^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/);
      if (rangeMatch?.[1] && rangeMatch[2] && rangeMatch[3] && rangeMatch[4]) {
        startTime = `${rangeMatch[1].padStart(2, "0")}:${rangeMatch[2]}`;
        endTime = `${rangeMatch[3].padStart(2, "0")}:${rangeMatch[4]}`;
        break;
      }
      await update.reply(
        `${e("⚠️", E.WARNING)} Формат: <code>ЧЧ:ММ–ЧЧ:ММ</code> (например 09:00–18:00) или выберите через виджет`,
        { parse_mode: "HTML" },
      );
    }
  }

  // Phase 2: Ask for interval in minutes
  const kb2 = new InlineKeyboard();
  const presets = [5, 10, 15, 20, 30, 45, 60, 90, 120];
  for (let i = 0; i < presets.length; i++) {
    const label = presets[i]! >= 60 ? `${presets[i]! / 60} ч.` : `${presets[i]} мин.`;
    kb2.text(label, `conv:interval:${presets[i]}`);
    if (i === 2 || i === 5 || i === 8) kb2.row();
  }
  kb2.row();
  kb2.text("Отменить", "conv:cancel").icon(E.CANCEL).row();

  await ctx.reply(
    `${e("🕓", E.SCHEDULE)} <b>Интервал отправки</b>\n\n` +
      `Диапазон: ${startTime}–${endTime}\n\n` +
      `Выберите интервал или введите количество минут:`,
    { reply_markup: kb2, parse_mode: "HTML" },
  );

  // Phase 3: Get interval minutes
  let intervalMinutes = 0;
  while (true) {
    const update = await conversation.wait();

    if (update.callbackQuery?.data === "conv:cancel") {
      await update.answerCallbackQuery();
      await showPlanPostDetail(bc(update), postId);
      return;
    }

    if (update.callbackQuery?.data?.startsWith("conv:interval:")) {
      await update.answerCallbackQuery();
      intervalMinutes = parseInt(update.callbackQuery.data.split(":")[2]!, 10);
      break;
    }

    if (update.message?.text) {
      const text = update.message.text.trim();
      if (/^\d+$/.test(text) && parseInt(text) >= 1) {
        intervalMinutes = parseInt(text);
        break;
      }
      await update.reply(`${e("⚠️", E.WARNING)} Введите число минут (≥ 1)`, { parse_mode: "HTML" });
    }
  }

  // Phase 4: Save
  db.updatePlanPost(postId, {
    send_time: startTime,
    interval_minutes: intervalMinutes,
    interval_end_time: endTime,
    interval_sent_count: 0,
    is_auto_time: 0,
  });

  const updated = db.getPlanPost(postId);
  await ctx.reply(
    `${e("✅", E.CONFIRM)} Интервал установлен: ${startTime}–${endTime}, каждые ${intervalMinutes} мин.`,
    { parse_mode: "HTML" },
  );
  await showPlanPostDetail(bc(ctx), postId);
}
