import { InlineKeyboard } from "grammy";
import type { Api } from "grammy";
import type { BotContext } from "../types";
import { e, E } from "../utils/emoji";
import * as db from "../db";
import * as userbot from "../userbot";

/** Delete a message by chatId + messageId, silently ignoring errors */
export async function safeDelete(api: Api, chatId: number | string, msgId: number) {
  try { await api.deleteMessage(chatId, msgId); } catch { /* already deleted */ }
}

/* ═══════════════════ Campaign List ═════════════════════════ */

export async function showCampaignList(ctx: BotContext, edit = true) {
  const campaigns = db.getAllCampaigns();

  const kb = new InlineKeyboard();
  for (const c of campaigns) {
    const icon = c.is_active ? E.ACTIVE : E.STOPPED;
    kb.text(c.name, `cmp:${c.id}`).icon(icon).row();
  }
  kb.text("Создать кампанию", "cmp:add").icon(E.ADD).row();
  kb.text("Назад", "main").icon(E.BACK).row();

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
  const groups = db.getBroadcastGroups(id);
  const pPosts = db.getUnsentPlanPosts(id);
  const status = cmp.is_active
    ? `${e("✅", E.ACTIVE)} Активна`
    : `${e("🚫", E.STOPPED)} Остановлена`;
  const chNames = channels.length
    ? channels.map((c) => c.title || c.username || c.chat_id).join(", ")
    : "—";

  const text = [
    `${e("🔗", E.CAMPAIGN)} <b>${cmp.name}</b>`,
    "",
    `${status}`,
    `${e("🕓", E.SCHEDULE)} Дефолт-время плана: ${cmp.default_time}`,
    `${e("📢", E.CHANNELS)} Каналы: ${chNames}`,
    `${e("📨", E.AUTOSPAM)} Автоспам: ${groups.length} групп`,
    `${e("📥", E.PLAN)} План постов: ${pPosts.length} в очереди`,
  ].join("\n");

  const kb = new InlineKeyboard()
    .text(`Автоспам (${groups.length})`, `bg:list:${id}`).icon(E.AUTOSPAM)
    .row()
    .text(`План постов (${pPosts.length})`, `pp:list:${id}`).icon(E.PLAN)
    .row()
    .text(`Каналы (${channels.length})`, `cmpch:list:${id}`).icon(E.CHANNELS)
    .row()
    .text("Дефолт-время", `cmp:deftime:${id}`).icon(E.SCHEDULE)
    .row();

  if (cmp.is_active) {
    kb.text("Остановить", `cmp:toggle:${id}`).icon(E.PAUSE).row();
  } else {
    kb.text("Запустить", `cmp:toggle:${id}`).icon(E.START).row();
  }

  kb.text("Переименовать", `cmp:rename:${id}`).icon(E.RENAME).row();
  kb.text("Удалить", `cmp:del:${id}`).icon(E.DELETE).row();
  kb.text("Назад", "campaigns:list").icon(E.BACK).row();

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
    kb.text(label, `cmpch:unlink:${cmpId}:${ch.id}`).icon(E.CANCEL).row();
  }
  kb.text("Привязать канал", `cmpch:link:${cmpId}`).icon(E.ADD).row();
  kb.text("Назад", `cmp:${cmpId}`).icon(E.BACK).row();

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
      kb.text(label, `cmpch:dolink:${cmpId}:${ch.id}`).icon(E.CHANNELS).row();
    }
  }
  kb.text("Назад", `cmpch:list:${cmpId}`).icon(E.BACK).row();

  await ctx.editMessageText("Выберите канал для привязки:", {
    reply_markup: kb,
    parse_mode: "HTML",
  });
}

/* ═══════════════ Broadcast Groups (Autospam) ══════════════ */

export async function showBroadcastGroups(ctx: BotContext, cmpId: number, edit = true) {
  const cmp = db.getCampaign(cmpId);
  if (!cmp) return;

  const groups = db.getBroadcastGroups(cmpId);

  const kb = new InlineKeyboard();
  for (const g of groups) {
    const remaining = g.total_days - g.days_sent;
    const postCount = db.countBroadcastGroupPosts(g.id);
    kb.text(`${g.label} (${g.send_time}, ${remaining} дн., ${postCount} пост.)`, `bg:${g.id}`).icon(E.PACKAGE).row();
  }
  kb.text("Создать группу постов", `bg:add:${cmpId}`).icon(E.ADD).row();
  kb.text("Назад", `cmp:${cmpId}`).icon(E.BACK).row();

  const text = [
    `${e("📨", E.AUTOSPAM)} <b>Автоспам «${cmp.name}»</b>`,
    "",
    `Групп постов: ${groups.length}`,
  ].join("\n");

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function showBroadcastGroupDetail(ctx: BotContext, groupId: number) {
  const group = db.getBroadcastGroup(groupId);
  if (!group) return;

  const posts = db.getBroadcastGroupPosts(groupId);
  const remaining = group.total_days - group.days_sent;

  const text = [
    `${e("📦", E.PACKAGE)} <b>${group.label}</b>`,
    "",
    `Позиция: ${group.position + 1}`,
    `${e("🕓", E.SCHEDULE)} Время: ${group.send_time}`,
    `Осталось дней: ${remaining}`,
    `Постов в группе: ${posts.length}`,
  ].join("\n");

  const kb = new InlineKeyboard()
    .text(`Посты (${posts.length})`, `bgp:list:${groupId}`).icon(E.FILE)
    .row()
    .text("Добавить пост", `bgp:add:${groupId}`).icon(E.ADD)
    .row()
    .text("Удалить группу", `bg:del:${groupId}`).icon(E.DELETE)
    .row()
    .text("Назад", `bg:list:${group.campaign_id}`).icon(E.BACK)
    .row();

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function showBroadcastGroupPostList(ctx: BotContext, groupId: number) {
  const group = db.getBroadcastGroup(groupId);
  if (!group) return;

  const posts = db.getBroadcastGroupPosts(groupId);

  const kb = new InlineKeyboard();
  for (const p of posts) {
    kb.text(p.label, `bgp:view:${p.id}`).icon(E.FILE).row();
  }
  kb.text("Добавить пост", `bgp:add:${groupId}`).icon(E.ADD).row();
  kb.text("Назад", `bg:${groupId}`).icon(E.BACK).row();

  const text = [
    `${e("📁", E.FILE)} <b>Посты группы «${group.label}»</b>`,
    "",
    `Всего: ${posts.length}`,
    posts.length > 1
      ? "При рассылке выбирается случайный пост (не повторяя предыдущий)."
      : "",
  ].join("\n");

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

export async function showBroadcastGroupPostPreview(ctx: BotContext, postId: number) {
  const post = db.getBroadcastGroupPost(postId);
  if (!post) return;

  const group = db.getBroadcastGroup(post.group_id);
  if (!group) return;

  const chatId = ctx.chat!.id;

  const bgpOpts = post.reply_markup ? { reply_markup: JSON.parse(post.reply_markup) } : {};
  let previewMsgId: number;
  try {
    const sent = await ctx.api.copyMessage(chatId, parseInt(post.chat_id), post.message_id, bgpOpts);
    previewMsgId = sent.message_id;
  } catch {
    await ctx.reply(`${e("⚠️", E.WARNING)} Не удалось загрузить пост.`, { parse_mode: "HTML" });
    return;
  }

  const kb = new InlineKeyboard()
    .text("Удалить пост", `bgp:del:${postId}:${previewMsgId}`).icon(E.DELETE)
    .row()
    .text("Назад", `bgp:back:${post.group_id}:${previewMsgId}`).icon(E.BACK)
    .row();

  await ctx.api.sendMessage(
    chatId,
    `${e("📁", E.FILE)} <b>${post.label}</b>`,
    { reply_markup: kb, parse_mode: "HTML", reply_parameters: { message_id: previewMsgId } },
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
      ? "АВТО"
      : p.send_time
        ? `${p.send_date || "?"} ${p.send_time}`
        : "";
    const icon = p.is_auto_time ? E.ROBOT : E.SCHEDULE;
    const label = tl ? `${tl} ${p.label}` : p.label;
    kb.text(label, `pp:${p.id}`).icon(icon).row();
  }
  kb.text("Добавить пост", `pp:add:${cmpId}`).icon(E.ADD).row();

  if (posts.length >= 2) {
    kb.text("Растянуть по дням", `pp:stretch:${cmpId}`).icon(E.SCHEDULE).row();
  }

  kb.text("Назад", `cmp:${cmpId}`).icon(E.BACK).row();

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

export async function showPlanPostDetail(ctx: BotContext, postId: number) {
  const post = db.getPlanPost(postId);
  if (!post) return;

  const cmp = db.getCampaign(post.campaign_id);
  const chatId = ctx.chat!.id;

  const ppOpts = post.reply_markup ? { reply_markup: JSON.parse(post.reply_markup) } : {};
  let previewMsgId: number;
  try {
    const sent = await ctx.api.copyMessage(chatId, parseInt(post.chat_id), post.message_id, ppOpts);
    previewMsgId = sent.message_id;
  } catch {
    await ctx.reply(`${e("⚠️", E.WARNING)} Не удалось загрузить пост.`, { parse_mode: "HTML" });
    return;
  }

  const text = [
    `${e("📁", E.FILE)} <b>${post.label}</b>`,
    "",
    `${e("🕓", E.SCHEDULE)} Дата: ${post.send_date || "не задана"}`,
    `${e("🕓", E.SCHEDULE)} Время: ${post.send_time || (post.is_auto_time ? `авто (${cmp?.default_time || "12:00"})` : "не задано")}`,
    `Статус: ${post.is_sent ? `${e("✅", E.ACTIVE)} Отправлен` : `${e("🕓", E.SCHEDULE)} В очереди`}`,
  ].join("\n");

  const kb = new InlineKeyboard()
    .text("Дата и время", `pp:datetime:${postId}:${previewMsgId}`).icon(E.SCHEDULE)
    .row()
    .text(post.is_auto_time ? "АВТО ✓" : "АВТО", `pp:auto:${postId}:${previewMsgId}`).icon(E.ROBOT)
    .row();
  kb.text("Удалить", `pp:del:${postId}:${previewMsgId}`).icon(E.DELETE).row();
  kb.text("Назад", `pp:back:${post.campaign_id}:${previewMsgId}`).icon(E.BACK).row();

  await ctx.api.sendMessage(
    chatId,
    text,
    { reply_markup: kb, parse_mode: "HTML", reply_parameters: { message_id: previewMsgId } },
  );
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
  kb.text("Назад", `pp:list:${cmpId}`).icon(E.BACK).row();

  await ctx.editMessageText(
    `${e("🕓", E.SCHEDULE)} <b>Растянуть ${unsent.length} постов</b>\n\nВыберите период:`,
    { reply_markup: kb, parse_mode: "HTML" },
  );
}

/* ═══════════════════ Userbot Menu ══════════════════════════ */

export async function showUserbotMenu(ctx: BotContext, edit = true) {
  const connected = userbot.isLoggedIn();

  const text = connected
    ? `${e("🤖", E.ROBOT)} <b>Юзербот</b>\n\nСтатус: ${e("✅", E.ACTIVE)} Подключён`
    : `${e("🤖", E.ROBOT)} <b>Юзербот</b>\n\nСтатус: ${e("🚫", E.STOPPED)} Не подключён`;

  const kb = new InlineKeyboard();
  if (connected) {
    kb.text("Отвязать сессию", "ub:logout").icon(E.DELETE).row();
  } else {
    kb.text("Войти по номеру", "ub:login").icon(E.LOCK).row();
    kb.text("Импорт сессии (строка)", "ub:import").icon(E.FILE).row();
  }
  kb.text("Назад", "main").icon(E.BACK).row();

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}
