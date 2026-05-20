import { InlineKeyboard } from "grammy";
import { tgwidget } from "tgwidget";
import type { BotContext } from "../types";
import { BOT_USERNAME } from "../config";
import * as db from "../db";

/* ═══════════════════ Campaign List ═════════════════════════ */

export async function showCampaignList(ctx: BotContext, edit = true) {
  const campaigns = db.getAllCampaigns();

  const kb = new InlineKeyboard();
  for (const c of campaigns) {
    const st = c.is_active ? "🟢" : "🔴";
    kb.text(`${st} ${c.name}`, `cmp:${c.id}`).row();
  }
  kb.text("➕ Создать кампанию", "cmp:add").row();
  kb.text("◀️ Назад", "main").row();

  const text = `📡 <b>Кампании</b>\n\nВсего: ${campaigns.length}`;

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

/* ═══════════════════ Campaign Detail ═══════════════════════ */

export async function showCampaignDetail(ctx: BotContext, id: number, edit = true) {
  const cmp = db.getCampaign(id);
  if (!cmp) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery("Кампания не найдена");
    return;
  }

  const channels = db.getCampaignChannels(id);
  const bPosts = db.getBroadcastPosts(id);
  const pPosts = db.getUnsentPlanPosts(id);
  const status = cmp.is_active ? "🟢 Активна" : "🔴 Остановлена";
  const sched =
    cmp.schedule_type === "simple"
      ? `Ежедневно в ${cmp.schedule_value}`
      : "Подробное расписание";
  const chNames = channels.length
    ? channels.map((c) => c.title || c.username || c.chat_id).join(", ")
    : "—";

  const text = [
    `📡 <b>${cmp.name}</b>`,
    "",
    `${status}`,
    `⏰ Расписание: ${sched}`,
    `🕐 Дефолт-время плана: ${cmp.default_time}`,
    `📢 Каналы: ${chNames}`,
    `📤 Авторассылка: ${bPosts.length} постов`,
    `📝 План постов: ${pPosts.length} в очереди`,
  ].join("\n");

  const kb = new InlineKeyboard()
    .text(`📤 Авторассылка (${bPosts.length})`, `bp:list:${id}`)
    .row()
    .text(`📝 План постов (${pPosts.length})`, `pp:list:${id}`)
    .row()
    .text(`📢 Каналы (${channels.length})`, `cmpch:list:${id}`)
    .row()
    .text("⏰ Расписание", `cmp:sched:${id}`)
    .row()
    .text("🕐 Дефолт-время", `cmp:deftime:${id}`)
    .row();

  if (cmp.is_active) {
    kb.text("⏸ Остановить", `cmp:toggle:${id}`).row();
  } else {
    kb.text("▶️ Запустить", `cmp:toggle:${id}`).row();
  }

  kb.text("✏️ Переименовать", `cmp:rename:${id}`).row();
  kb.text("🗑 Удалить", `cmp:del:${id}`).row();
  kb.text("◀️ Назад", "campaigns:list").row();

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

/* ═══════════════ Campaign Channels ═════════════════════════ */

export async function showCampaignChannels(ctx: BotContext, cmpId: number, edit = true) {
  const cmp = db.getCampaign(cmpId);
  if (!cmp) return;

  const linked = db.getCampaignChannels(cmpId);

  const kb = new InlineKeyboard();
  for (const ch of linked) {
    const label = ch.title || ch.username || ch.chat_id;
    kb.text(`❌ ${label}`, `cmpch:unlink:${cmpId}:${ch.id}`).row();
  }
  kb.text("➕ Привязать канал", `cmpch:link:${cmpId}`).row();
  kb.text("◀️ Назад", `cmp:${cmpId}`).row();

  const text = [
    `📢 <b>Каналы кампании «${cmp.name}»</b>`,
    "",
    linked.length ? "Нажмите ❌ чтобы отвязать." : "Нет привязанных каналов.",
  ].join("\n");

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function showLinkChannelPicker(ctx: BotContext, cmpId: number) {
  const available = db.getChannelsNotInCampaign(cmpId);

  const kb = new InlineKeyboard();
  if (available.length === 0) {
    kb.text("Нет доступных каналов", "noop").row();
  } else {
    for (const ch of available) {
      const label = ch.title || ch.username || ch.chat_id;
      kb.text(`📢 ${label}`, `cmpch:dolink:${cmpId}:${ch.id}`).row();
    }
  }
  kb.text("◀️ Назад", `cmpch:list:${cmpId}`).row();

  await ctx.editMessageText("Выберите канал для привязки:", {
    reply_markup: kb,
    parse_mode: "HTML",
  });
}

/* ═══════════════ Schedule Picker ═══════════════════════════ */

export async function showScheduleChoice(ctx: BotContext, cmpId: number) {
  const bot = BOT_USERNAME;
  const kb = new InlineKeyboard();

  if (bot) {
    const tw = tgwidget(bot).date({ mode: "time" }).style({ liquidGlass: true, adoptTgPalette: true });
    kb.url("🕐 Простое время", tw.url().replace("start=", `start=tw_ct_${cmpId}_`)).row();

    const sw = tgwidget(bot).schedule({ format: "single" }).style({ liquidGlass: true, adoptTgPalette: true });
    kb.url("📋 Подробное расписание", sw.url().replace("start=", `start=tw_cs_${cmpId}_`)).row();
  } else {
    kb.text("🕐 Простое время", `cmp:simpletime:${cmpId}`).row();
    kb.text("📋 Подробное расписание", `cmp:dettime:${cmpId}`).row();
  }

  kb.text("◀️ Назад", `cmp:${cmpId}`).row();

  await ctx.editMessageText("⏰ <b>Выберите тип расписания:</b>", {
    reply_markup: kb,
    parse_mode: "HTML",
  });
}

/* ═══════════════ Broadcast Posts ═══════════════════════════ */

export async function showBroadcastPosts(ctx: BotContext, cmpId: number, edit = true) {
  const cmp = db.getCampaign(cmpId);
  if (!cmp) return;

  const posts = db.getBroadcastPosts(cmpId);

  const kb = new InlineKeyboard();
  for (const p of posts) {
    kb.text(`📄 ${p.label}`, `bp:${p.id}`).row();
  }
  kb.text("➕ Добавить пост", `bp:add:${cmpId}`).row();
  kb.text("◀️ Назад", `cmp:${cmpId}`).row();

  const text = [
    `📤 <b>Авторассылка «${cmp.name}»</b>`,
    "",
    `Постов: ${posts.length}`,
    posts.length ? "\nБот выбирает случайный пост без повторов подряд." : "",
  ].join("\n");

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function showBroadcastPostDetail(ctx: BotContext, postId: number) {
  const post = db.getBroadcastPost(postId);
  if (!post) return;

  const kb = new InlineKeyboard()
    .text("👁 Предпросмотр", `bp:preview:${postId}`)
    .row()
    .text("🗑 Удалить", `bp:del:${postId}`)
    .row()
    .text("◀️ Назад", `bp:list:${post.campaign_id}`)
    .row();

  await ctx.editMessageText(`📄 <b>${post.label}</b>\n\nПозиция: ${post.position + 1}`, {
    reply_markup: kb,
    parse_mode: "HTML",
  });
}

/* ═══════════════════ Plan Posts ════════════════════════════ */

export async function showPlanPosts(ctx: BotContext, cmpId: number, edit = true) {
  const cmp = db.getCampaign(cmpId);
  if (!cmp) return;

  const posts = db.getUnsentPlanPosts(cmpId);

  const kb = new InlineKeyboard();
  for (const p of posts) {
    const tl = p.is_auto_time
      ? "🤖"
      : p.send_time
        ? `${p.send_date || "?"} ${p.send_time}`
        : "⏳";
    kb.text(`${tl} ${p.label}`, `pp:${p.id}`).row();
  }
  kb.text("➕ Добавить пост", `pp:add:${cmpId}`).row();

  if (posts.length >= 2) {
    kb.text("📅 Растянуть по дням", `pp:stretch:${cmpId}`).row();
  }

  kb.text("◀️ Назад", `cmp:${cmpId}`).row();

  const text = [
    `📝 <b>План постов «${cmp.name}»</b>`,
    `Дефолт-время: ${cmp.default_time}`,
    "",
    `В очереди: ${posts.length}`,
  ].join("\n");

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function showPlanPostDetail(ctx: BotContext, postId: number, edit = true) {
  const post = db.getPlanPost(postId);
  if (!post) return;

  const cmp = db.getCampaign(post.campaign_id);
  const bot = BOT_USERNAME;

  const text = [
    `📄 <b>${post.label}</b>`,
    "",
    `📅 Дата: ${post.send_date || "не задана"}`,
    `⏰ Время: ${post.send_time || (post.is_auto_time ? `авто (${cmp?.default_time || "12:00"})` : "не задано")}`,
    `Статус: ${post.is_sent ? "✅ Отправлен" : "⏳ В очереди"}`,
  ].join("\n");

  const kb = new InlineKeyboard();

  if (bot) {
    const dtw = tgwidget(bot).date({ mode: "datetime" }).style({ liquidGlass: true, adoptTgPalette: true });
    kb.url("📅 Дата и время", dtw.url().replace("start=", `start=tw_pdt_${postId}_`)).row();
  } else {
    kb.text("📅 Дата", `pp:setdate:${postId}`).row();
    kb.text("⏰ Время", `pp:settime:${postId}`).row();
  }

  kb.text(post.is_auto_time ? "🤖 АВТО ✓" : "🤖 АВТО", `pp:auto:${postId}`).row();
  kb.text("👁 Предпросмотр", `pp:preview:${postId}`).row();
  kb.text("🗑 Удалить", `pp:del:${postId}`).row();
  kb.text("◀️ Назад", `pp:list:${post.campaign_id}`).row();

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function showStretchConfig(ctx: BotContext, cmpId: number) {
  const unsent = db.getUnsentPlanPosts(cmpId);

  const kb = new InlineKeyboard();
  const days = [3, 5, 7, 10, 14, 21, 30];
  for (let i = 0; i < days.length; i++) {
    kb.text(`${days[i]} дн.`, `pp:dostretch:${cmpId}:${days[i]}`);
    if (i === 2 || i === 4) kb.row();
  }
  kb.row();
  kb.text("◀️ Назад", `pp:list:${cmpId}`).row();

  await ctx.editMessageText(
    `📅 <b>Растянуть ${unsent.length} постов</b>\n\nВыберите период:`,
    { reply_markup: kb, parse_mode: "HTML" },
  );
}
