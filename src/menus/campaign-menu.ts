import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { e, E } from "../utils/emoji";
import * as db from "../db";

/* ═══════════════════ Campaign List ═════════════════════════ */

export async function showCampaignList(ctx: BotContext, edit = true) {
  const campaigns = db.getAllCampaigns();

  const kb = new InlineKeyboard();
  for (const c of campaigns) {
    const st = c.is_active ? "✅" : "🚫";
    kb.text(`${st} ${c.name}`, `cmp:${c.id}`).row();
  }
  kb.text("➕ Создать кампанию", "cmp:add").row();
  kb.text("◀️ Назад", "main").row();

  const text = `${e("🔗", E.CAMPAIGN)} <b>Кампании</b>\n\nВсего: ${campaigns.length}`;

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
  const status = cmp.is_active
    ? `${e("✅", E.ACTIVE)} Активна`
    : `${e("🚫", E.STOPPED)} Остановлена`;
  const sched =
    cmp.schedule_type === "simple"
      ? `Ежедневно в ${cmp.schedule_value}`
      : "Подробное расписание";
  const chNames = channels.length
    ? channels.map((c) => c.title || c.username || c.chat_id).join(", ")
    : "—";

  const text = [
    `${e("🔗", E.CAMPAIGN)} <b>${cmp.name}</b>`,
    "",
    `${status}`,
    `${e("🕓", E.SCHEDULE)} Расписание: ${sched}`,
    `${e("🕓", E.SCHEDULE)} Дефолт-время плана: ${cmp.default_time}`,
    `${e("📢", E.CHANNELS)} Каналы: ${chNames}`,
    `${e("📨", E.AUTOSPAM)} Автоспам: ${bPosts.length} постов`,
    `${e("📥", E.PLAN)} План постов: ${pPosts.length} в очереди`,
  ].join("\n");

  const kb = new InlineKeyboard()
    .text(`📨 Автоспам (${bPosts.length})`, `bp:list:${id}`)
    .row()
    .text(`📥 План постов (${pPosts.length})`, `pp:list:${id}`)
    .row()
    .text(`📢 Каналы (${channels.length})`, `cmpch:list:${id}`)
    .row()
    .text("🕓 Расписание", `cmp:sched:${id}`)
    .row()
    .text("🕓 Дефолт-время", `cmp:deftime:${id}`)
    .row();

  if (cmp.is_active) {
    kb.text("🔽 Остановить", `cmp:toggle:${id}`).row();
  } else {
    kb.text("🔼 Запустить", `cmp:toggle:${id}`).row();
  }

  kb.text("🔨 Переименовать", `cmp:rename:${id}`).row();
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
    kb.text(`🚫 ${label}`, `cmpch:unlink:${cmpId}:${ch.id}`).row();
  }
  kb.text("➕ Привязать канал", `cmpch:link:${cmpId}`).row();
  kb.text("◀️ Назад", `cmp:${cmpId}`).row();

  const text = [
    `${e("📢", E.CHANNELS)} <b>Каналы кампании «${cmp.name}»</b>`,
    "",
    linked.length
      ? `Нажмите ${e("🚫", E.CANCEL)} чтобы отвязать.`
      : "Нет привязанных каналов.",
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



/* ═══════════════ Broadcast Posts (Autospam) ════════════════ */

export async function showBroadcastPosts(ctx: BotContext, cmpId: number, edit = true) {
  const cmp = db.getCampaign(cmpId);
  if (!cmp) return;

  const posts = db.getBroadcastPosts(cmpId);

  const kb = new InlineKeyboard();
  for (const p of posts) {
    kb.text(`📁 ${p.label}`, `bp:${p.id}`).row();
  }
  kb.text("➕ Добавить пост", `bp:add:${cmpId}`).row();
  kb.text("◀️ Назад", `cmp:${cmpId}`).row();

  const text = [
    `${e("📨", E.AUTOSPAM)} <b>Автоспам «${cmp.name}»</b>`,
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
    .text("🔍 Предпросмотр", `bp:preview:${postId}`)
    .row()
    .text("🗑 Удалить", `bp:del:${postId}`)
    .row()
    .text("◀️ Назад", `bp:list:${post.campaign_id}`)
    .row();

  await ctx.editMessageText(
    `${e("📁", E.FILE)} <b>${post.label}</b>\n\nПозиция: ${post.position + 1}`,
    { reply_markup: kb, parse_mode: "HTML" },
  );
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
        : "🕓";
    kb.text(`${tl} ${p.label}`, `pp:${p.id}`).row();
  }
  kb.text("➕ Добавить пост", `pp:add:${cmpId}`).row();

  if (posts.length >= 2) {
    kb.text("🕓 Растянуть по дням", `pp:stretch:${cmpId}`).row();
  }

  kb.text("◀️ Назад", `cmp:${cmpId}`).row();

  const text = [
    `${e("📥", E.PLAN)} <b>План постов «${cmp.name}»</b>`,
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

  const text = [
    `${e("📁", E.FILE)} <b>${post.label}</b>`,
    "",
    `${e("🕓", E.SCHEDULE)} Дата: ${post.send_date || "не задана"}`,
    `${e("🕓", E.SCHEDULE)} Время: ${post.send_time || (post.is_auto_time ? `авто (${cmp?.default_time || "12:00"})` : "не задано")}`,
    `Статус: ${post.is_sent ? `${e("✅", E.ACTIVE)} Отправлен` : `${e("🕓", E.SCHEDULE)} В очереди`}`,
  ].join("\n");

  const kb = new InlineKeyboard()
    .text("🕓 Дата и время", `pp:datetime:${postId}`)
    .row()
    .text(post.is_auto_time ? "🤖 АВТО ✓" : "🤖 АВТО", `pp:auto:${postId}`)
    .row();
  kb.text("🔍 Предпросмотр", `pp:preview:${postId}`).row();
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
    `${e("🕓", E.SCHEDULE)} <b>Растянуть ${unsent.length} постов</b>\n\nВыберите период:`,
    { reply_markup: kb, parse_mode: "HTML" },
  );
}
