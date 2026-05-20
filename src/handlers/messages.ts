import type { BotContext } from "../types";
import { isAdmin } from "../utils/admin";
import { getAwaiting, clearAwaiting } from "./callbacks";
import { getPostLabel } from "../utils/post-label";
import { showChannelList } from "../menus/channel-menu";
import { showCampaignDetail, showBroadcastPosts, showPlanPosts } from "../menus/campaign-menu";
import * as db from "../db";

const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleMessage(ctx: BotContext) {
  if (!isAdmin(ctx)) return;
  if (!ctx.message) return;

  const userId = ctx.from!.id;
  const state = getAwaiting(userId);
  if (!state) return;

  const msg = ctx.message;

  switch (state.action) {
    /* ── Add channel ─────────────────────────────────────── */
    case "add_channel": {
      let chatId: string | null = null;
      let title = "";
      let username: string | null = null;

      // Forwarded from channel
      if (msg.forward_origin && "type" in msg.forward_origin && msg.forward_origin.type === "channel") {
        const ch = msg.forward_origin.chat;
        chatId = String(ch.id);
        title = ch.title || "";
        username = ("username" in ch ? ch.username : null) ?? null;
      }
      // Text: ID or @username
      else if (msg.text) {
        const text = msg.text.trim();
        if (text.startsWith("-100") && /^-\d+$/.test(text)) {
          chatId = text;
        } else if (text.startsWith("@")) {
          username = text.slice(1);
          chatId = text; // will verify below
        } else {
          await ctx.reply("⚠️ Отправьте ID канала (-100...), @username или пересланное сообщение.");
          return;
        }
      } else {
        await ctx.reply("⚠️ Отправьте текст с ID/@username или перешлите сообщение из канала.");
        return;
      }

      if (!chatId) {
        await ctx.reply("⚠️ Не удалось определить канал.");
        return;
      }

      // Verify bot access to channel
      try {
        const chat = await ctx.api.getChat(chatId);
        if (chat.type !== "channel") {
          await ctx.reply("⚠️ Это не канал.");
          return;
        }
        chatId = String(chat.id);
        title = ("title" in chat ? chat.title : "") || title;
        username = ("username" in chat ? chat.username : null) ?? username;
      } catch {
        await ctx.reply("⚠️ Бот не имеет доступа к этому каналу. Добавьте бота как администратора.");
        return;
      }

      // Check duplicate
      if (db.getChannelByChatId(chatId)) {
        await ctx.reply("ℹ️ Этот канал уже добавлен.");
        clearAwaiting(userId);
        return;
      }

      db.addChannel(chatId, title, username);
      clearAwaiting(userId);
      await ctx.reply(`✅ Канал <b>${title || chatId}</b> добавлен.`, { parse_mode: "HTML" });
      await showChannelList(ctx, false);
      return;
    }

    /* ── Name new campaign ───────────────────────────────── */
    case "name_campaign": {
      if (!msg.text) {
        await ctx.reply("⚠️ Отправьте текстовое название.");
        return;
      }
      const cmp = db.addCampaign(msg.text.trim());
      clearAwaiting(userId);
      await ctx.reply(`✅ Кампания <b>${cmp.name}</b> создана.`, { parse_mode: "HTML" });
      await showCampaignDetail(ctx, cmp.id, false);
      return;
    }

    /* ── Rename campaign ─────────────────────────────────── */
    case "rename_campaign": {
      if (!msg.text || !state.id) {
        await ctx.reply("⚠️ Отправьте новое название.");
        return;
      }
      db.updateCampaign(state.id, { name: msg.text.trim() });
      clearAwaiting(userId);
      await ctx.reply("✅ Название обновлено.");
      await showCampaignDetail(ctx, state.id, false);
      return;
    }

    /* ── Set campaign simple time ────────────────────────── */
    case "set_campaign_time": {
      if (!msg.text || !state.id) return;
      const m = msg.text.trim().match(TIME_RE);
      if (!m || !m[1] || !m[2]) {
        await ctx.reply("⚠️ Формат: ЧЧ:ММ (например 09:30)");
        return;
      }
      const time = `${m[1].padStart(2, "0")}:${m[2]}`;
      db.updateCampaign(state.id, { schedule_type: "simple", schedule_value: time });
      clearAwaiting(userId);
      await ctx.reply(`⏰ Расписание: ежедневно в ${time}`);
      await showCampaignDetail(ctx, state.id, false);
      return;
    }

    /* ── Set campaign detailed schedule (text fallback) ─── */
    case "set_campaign_schedule": {
      if (!msg.text || !state.id) return;
      db.updateCampaign(state.id, { schedule_type: "detailed", schedule_value: msg.text.trim() });
      clearAwaiting(userId);
      await ctx.reply("📋 Расписание обновлено.");
      await showCampaignDetail(ctx, state.id, false);
      return;
    }

    /* ── Set default time ────────────────────────────────── */
    case "set_default_time": {
      if (!msg.text || !state.id) return;
      const m = msg.text.trim().match(TIME_RE);
      if (!m || !m[1] || !m[2]) {
        await ctx.reply("⚠️ Формат: ЧЧ:ММ");
        return;
      }
      const time = `${m[1].padStart(2, "0")}:${m[2]}`;
      db.updateCampaign(state.id, { default_time: time });
      clearAwaiting(userId);
      await ctx.reply(`🕐 Дефолт-время: ${time}`);
      await showCampaignDetail(ctx, state.id, false);
      return;
    }

    /* ── Add broadcast post ──────────────────────────────── */
    case "add_broadcast_post": {
      if (!state.id) return;
      const bpCount = db.getBroadcastPosts(state.id).length;
      const label = getPostLabel(msg, bpCount);
      try {
        db.addBroadcastPost(state.id, String(ctx.chat!.id), msg.message_id, label);
        await ctx.reply(`✅ Пост «${label}» добавлен в авторассылку.`);
      } catch {
        await ctx.reply("⚠️ Этот пост уже добавлен.");
      }
      return; // stay in awaiting mode for more posts
    }

    /* ── Add plan post ───────────────────────────────────── */
    case "add_plan_post": {
      if (!state.id) return;
      const ppCount = db.getUnsentPlanPosts(state.id).length;
      const label = getPostLabel(msg, ppCount);
      try {
        db.addPlanPost(state.id, String(ctx.chat!.id), msg.message_id, label);
        await ctx.reply(`✅ Пост «${label}» добавлен в план.`);
      } catch {
        await ctx.reply("⚠️ Этот пост уже добавлен.");
      }
      return; // stay in awaiting mode
    }

    /* ── Set plan post date ──────────────────────────────── */
    case "set_plan_date": {
      if (!msg.text || !state.id) return;
      if (!DATE_RE.test(msg.text.trim())) {
        await ctx.reply("⚠️ Формат: ГГГГ-ММ-ДД (например 2025-03-15)");
        return;
      }
      db.updatePlanPost(state.id, { send_date: msg.text.trim() });
      clearAwaiting(userId);
      await ctx.reply(`📅 Дата: ${msg.text.trim()}`);
      await showPlanPosts(ctx, db.getPlanPost(state.id)!.campaign_id, false);
      return;
    }

    /* ── Set plan post time ──────────────────────────────── */
    case "set_plan_time": {
      if (!msg.text || !state.id) return;
      const m = msg.text.trim().match(TIME_RE);
      if (!m || !m[1] || !m[2]) {
        await ctx.reply("⚠️ Формат: ЧЧ:ММ");
        return;
      }
      const time = `${m[1].padStart(2, "0")}:${m[2]}`;
      db.updatePlanPost(state.id, { send_time: time, is_auto_time: 0 });
      clearAwaiting(userId);
      await ctx.reply(`⏰ Время: ${time}`);
      await showPlanPosts(ctx, db.getPlanPost(state.id)!.campaign_id, false);
      return;
    }
  }
}
