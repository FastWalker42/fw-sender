import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types";
import { isAdmin } from "../utils/admin";
import { e, E } from "../utils/emoji";
import { showMainMenu } from "../menus/main-menu";
import { showChannelList, showChannelDetail, showDeleteChannelConfirm } from "../menus/channel-menu";
import {
  showCampaignList,
  showCampaignDetail,
  showCampaignChannels,
  showLinkChannelPicker,
  showBroadcastPosts,
  showBroadcastPostDetail,
  showPlanPosts,
  showPlanPostDetail,
  showStretchConfig,
} from "../menus/campaign-menu";
import * as db from "../db";

/* ═══════════ Awaiting-input state per user ═════════════════ */

interface AwaitState {
  action: string;
  id?: number;
}

const awaiting = new Map<number, AwaitState>();

export function getAwaiting(userId: number) {
  return awaiting.get(userId);
}
export function setAwaiting(userId: number, s: AwaitState) {
  awaiting.set(userId, s);
}
export function clearAwaiting(userId: number) {
  awaiting.delete(userId);
}

/* ═══════════════════ Main router ═══════════════════════════ */

export async function handleCallback(ctx: BotContext) {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery("⛔ Доступ запрещён");
    return;
  }

  const data = ctx.callbackQuery?.data;
  if (!data) return;

  await ctx.answerCallbackQuery();
  clearAwaiting(ctx.from!.id);

  if (data === "main") return showMainMenu(ctx, true);
  if (data === "noop") return;

  // ── Channels ──────────────────────────────────────────
  if (data === "channels:list") return showChannelList(ctx);

  if (data === "ch:add") {
    setAwaiting(ctx.from!.id, { action: "add_channel" });
    const kb = new InlineKeyboard().text("Отмена", "channels:list").icon(E.CANCEL);
    return ctx.editMessageText(
      `${e("📢", E.CHANNELS)} <b>Добавление канала</b>\n\n` +
        "Отправьте:\n" +
        "• Пересланное сообщение из канала\n" +
        "• ID канала (<code>-100...</code>)\n" +
        "• Username (<code>@channel</code>)",
      { reply_markup: kb, parse_mode: "HTML" },
    );
  }

  if (data.startsWith("ch:del:")) {
    return showDeleteChannelConfirm(ctx, parseId(data, 2));
  }

  if (data.startsWith("ch:confirmdel:")) {
    db.removeChannel(parseId(data, 2));
    return showChannelList(ctx);
  }

  if (data.startsWith("ch:")) {
    const id = parseId(data, 1);
    if (!isNaN(id)) return showChannelDetail(ctx, id);
  }

  // ── Campaigns ─────────────────────────────────────────
  if (data === "campaigns:list") return showCampaignList(ctx);

  if (data === "cmp:add") {
    setAwaiting(ctx.from!.id, { action: "name_campaign" });
    const kb = new InlineKeyboard().text("Отмена", "campaigns:list").icon(E.CANCEL);
    return ctx.editMessageText(`${e("🔗", E.CAMPAIGN)} Введите название кампании:`, {
      reply_markup: kb,
      parse_mode: "HTML",
    });
  }

  if (data.startsWith("cmp:toggle:")) {
    const id = parseId(data, 2);
    const cmp = db.getCampaign(id);
    if (cmp) db.updateCampaign(id, { is_active: cmp.is_active ? 0 : 1 });
    return showCampaignDetail(ctx, id);
  }

  if (data.startsWith("cmp:rename:")) {
    const id = parseId(data, 2);
    setAwaiting(ctx.from!.id, { action: "rename_campaign", id });
    const kb = new InlineKeyboard().text("Отмена", `cmp:${id}`).icon(E.CANCEL);
    return ctx.editMessageText(`${e("🔨", E.RENAME)} Введите новое название:`, {
      reply_markup: kb,
      parse_mode: "HTML",
    });
  }

  if (data.startsWith("cmp:del:")) {
    const id = parseId(data, 2);
    const cmp = db.getCampaign(id);
    if (!cmp) return;
    const kb = new InlineKeyboard()
      .text("Да", `cmp:confirmdel:${id}`).icon(E.CONFIRM)
      .text("Нет", `cmp:${id}`).icon(E.CANCEL);
    return ctx.editMessageText(`Удалить кампанию <b>${cmp.name}</b> со всеми данными?`, {
      reply_markup: kb,
      parse_mode: "HTML",
    });
  }

  if (data.startsWith("cmp:confirmdel:")) {
    db.removeCampaign(parseId(data, 2));
    return showCampaignList(ctx);
  }

  if (data.startsWith("cmp:sched:")) {
    const id = parseId(data, 2);
    ctx.session.convPayload = String(id);
    await ctx.conversation.enter("scheduleConversation");
    return;
  }

  if (data.startsWith("cmp:deftime:")) {
    const id = parseId(data, 2);
    ctx.session.convPayload = String(id);
    await ctx.conversation.enter("defaultTimeConversation");
    return;
  }

  if (data.startsWith("cmp:")) {
    const id = parseId(data, 1);
    if (!isNaN(id)) return showCampaignDetail(ctx, id);
  }

  // ── Campaign Channels ─────────────────────────────────
  if (data.startsWith("cmpch:list:")) return showCampaignChannels(ctx, parseId(data, 2));
  if (data.startsWith("cmpch:link:")) return showLinkChannelPicker(ctx, parseId(data, 2));

  if (data.startsWith("cmpch:dolink:")) {
    const cmpId = parseId(data, 2);
    const chId = parseId(data, 3);
    db.linkChannel(cmpId, chId);
    return showCampaignChannels(ctx, cmpId);
  }

  if (data.startsWith("cmpch:unlink:")) {
    const cmpId = parseId(data, 2);
    const chId = parseId(data, 3);
    db.unlinkChannel(cmpId, chId);
    return showCampaignChannels(ctx, cmpId);
  }

  // ── Broadcast Posts ───────────────────────────────────
  if (data.startsWith("bp:list:")) return showBroadcastPosts(ctx, parseId(data, 2));

  if (data.startsWith("bp:add:")) {
    const cmpId = parseId(data, 2);
    setAwaiting(ctx.from!.id, { action: "add_broadcast_post", id: cmpId });
    const kb = new InlineKeyboard().text("Готово", `bp:list:${cmpId}`).icon(E.CONFIRM);
    return ctx.editMessageText(
      `${e("📨", E.AUTOSPAM)} Отправьте пост(ы) для автоспама.\nПо окончании нажмите «Готово».`,
      { reply_markup: kb, parse_mode: "HTML" },
    );
  }

  if (data.startsWith("bp:preview:")) {
    const post = db.getBroadcastPost(parseId(data, 2));
    if (!post) return;
    try {
      await ctx.api.copyMessage(ctx.chat!.id, parseInt(post.chat_id), post.message_id);
    } catch {
      await ctx.reply(`${e("⚠️", E.WARNING)} Не удалось загрузить пост.`, { parse_mode: "HTML" });
    }
    return;
  }

  if (data.startsWith("bp:del:")) {
    const post = db.getBroadcastPost(parseId(data, 2));
    if (!post) return;
    db.removeBroadcastPost(post.id);
    return showBroadcastPosts(ctx, post.campaign_id);
  }

  if (data.startsWith("bp:")) {
    const id = parseId(data, 1);
    if (!isNaN(id)) return showBroadcastPostDetail(ctx, id);
  }

  // ── Plan Posts ────────────────────────────────────────
  if (data.startsWith("pp:list:")) return showPlanPosts(ctx, parseId(data, 2));

  if (data.startsWith("pp:add:")) {
    const cmpId = parseId(data, 2);
    setAwaiting(ctx.from!.id, { action: "add_plan_post", id: cmpId });
    const kb = new InlineKeyboard().text("Готово", `pp:list:${cmpId}`).icon(E.CONFIRM);
    return ctx.editMessageText(
      `${e("📥", E.PLAN)} Отправьте пост(ы) для плана.\nПо окончании нажмите «Готово».`,
      { reply_markup: kb, parse_mode: "HTML" },
    );
  }

  if (data.startsWith("pp:auto:")) {
    const id = parseId(data, 2);
    const post = db.getPlanPost(id);
    if (!post) return;
    if (post.is_auto_time) {
      db.updatePlanPost(id, { is_auto_time: 0 });
    } else {
      const cmp = db.getCampaign(post.campaign_id);
      db.updatePlanPost(id, { is_auto_time: 1, send_time: cmp?.default_time || "12:00" });
    }
    return showPlanPostDetail(ctx, id);
  }

  if (data.startsWith("pp:preview:")) {
    const post = db.getPlanPost(parseId(data, 2));
    if (!post) return;
    try {
      await ctx.api.copyMessage(ctx.chat!.id, parseInt(post.chat_id), post.message_id);
    } catch {
      await ctx.reply(`${e("⚠️", E.WARNING)} Не удалось загрузить пост.`, { parse_mode: "HTML" });
    }
    return;
  }

  if (data.startsWith("pp:del:")) {
    const post = db.getPlanPost(parseId(data, 2));
    if (!post) return;
    db.removePlanPost(post.id);
    return showPlanPosts(ctx, post.campaign_id);
  }

  if (data.startsWith("pp:stretch:")) return showStretchConfig(ctx, parseId(data, 2));

  if (data.startsWith("pp:dostretch:")) {
    const cmpId = parseId(data, 2);
    const totalDays = parseId(data, 3);
    return stretchPosts(ctx, cmpId, totalDays);
  }

  if (data.startsWith("pp:datetime:")) {
    const id = parseId(data, 2);
    ctx.session.convPayload = String(id);
    await ctx.conversation.enter("planDatetimeConversation");
    return;
  }

  if (data.startsWith("pp:")) {
    const id = parseId(data, 1);
    if (!isNaN(id)) return showPlanPostDetail(ctx, id);
  }
}

/* ═══════════════════ Helpers ═══════════════════════════════ */

function parseId(data: string, colonIndex: number): number {
  return parseInt(data.split(":")[colonIndex] ?? "0", 10);
}

async function stretchPosts(ctx: BotContext, cmpId: number, totalDays: number) {
  const cmp = db.getCampaign(cmpId);
  const posts = db.getUnsentPlanPosts(cmpId);
  if (posts.length === 0) return showPlanPosts(ctx, cmpId);

  const now = new Date();
  const interval = totalDays / posts.length;
  const defaultTime = cmp?.default_time || "12:00";

  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]!;
    const d = new Date(now);
    d.setDate(d.getDate() + Math.round(i * interval));
    const dateStr = d.toISOString().slice(0, 10);
    const timeStr = post.is_auto_time
      ? defaultTime
      : `${String(hours[i % hours.length]).padStart(2, "0")}:00`;

    db.updatePlanPost(post.id, { send_date: dateStr, send_time: timeStr });
  }

  return showPlanPosts(ctx, cmpId);
}
