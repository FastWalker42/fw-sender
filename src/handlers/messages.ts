import { InlineKeyboard } from "grammy";
import { tgwidget, parseDate } from "tgwidget";
import type { BotContext } from "../types";
import { BOT_USERNAME } from "../config";
import { isAdmin } from "../utils/admin";
import { e, E } from "../utils/emoji";
import { getAwaiting, clearAwaiting, setAwaiting } from "./callbacks";
import { getPostLabel } from "../utils/post-label";
import { showChannelList } from "../menus/channel-menu";
import { showCampaignDetail, showBroadcastPosts } from "../menus/campaign-menu";
import * as db from "../db";

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
          await ctx.reply(`${e("⚠️", E.WARNING)} Отправьте ID канала (-100...), @username или пересланное сообщение.`, { parse_mode: "HTML" });
          return;
        }
      } else {
        await ctx.reply(`${e("⚠️", E.WARNING)} Отправьте текст с ID/@username или перешлите сообщение из канала.`, { parse_mode: "HTML" });
        return;
      }

      if (!chatId) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Не удалось определить канал.`, { parse_mode: "HTML" });
        return;
      }

      // Verify bot access to channel
      try {
        const chat = await ctx.api.getChat(chatId);
        if (chat.type !== "channel") {
          await ctx.reply(`${e("⚠️", E.WARNING)} Это не канал.`, { parse_mode: "HTML" });
          return;
        }
        chatId = String(chat.id);
        title = ("title" in chat ? chat.title : "") || title;
        username = ("username" in chat ? chat.username : null) ?? username;
      } catch {
        await ctx.reply(`${e("⚠️", E.WARNING)} Бот не имеет доступа к этому каналу. Добавьте бота как администратора.`, { parse_mode: "HTML" });
        return;
      }

      // Check duplicate
      if (db.getChannelByChatId(chatId)) {
        await ctx.reply(`${e("ℹ️", E.INFO)} Этот канал уже добавлен.`, { parse_mode: "HTML" });
        clearAwaiting(userId);
        return;
      }

      db.addChannel(chatId, title, username);
      clearAwaiting(userId);
      await ctx.reply(`${e("✅", E.CONFIRM)} Канал <b>${title || chatId}</b> добавлен.`, { parse_mode: "HTML" });
      await showChannelList(ctx, false);
      return;
    }

    /* ── Name new campaign ───────────────────────────────── */
    case "name_campaign": {
      if (!msg.text) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Отправьте текстовое название.`, { parse_mode: "HTML" });
        return;
      }
      const cmp = db.addCampaign(msg.text.trim());
      clearAwaiting(userId);
      await ctx.reply(`${e("✅", E.CONFIRM)} Кампания <b>${cmp.name}</b> создана.`, { parse_mode: "HTML" });
      await showCampaignDetail(ctx, cmp.id, false);
      return;
    }

    /* ── Rename campaign ─────────────────────────────────── */
    case "rename_campaign": {
      if (!msg.text || !state.id) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Отправьте новое название.`, { parse_mode: "HTML" });
        return;
      }
      db.updateCampaign(state.id, { name: msg.text.trim() });
      clearAwaiting(userId);
      await ctx.reply(`${e("✅", E.CONFIRM)} Название обновлено.`, { parse_mode: "HTML" });
      await showCampaignDetail(ctx, state.id, false);
      return;
    }

    /* ── Add broadcast post (step 1: receive post) ─────── */
    case "add_broadcast_post": {
      if (!state.id) return;
      const bpCount = db.getBroadcastPosts(state.id).length;
      const label = getPostLabel(msg, bpCount);
      setAwaiting(userId, {
        action: "bp_enter_days",
        id: state.id,
        pending: { chatId: String(ctx.chat!.id), messageId: msg.message_id, label },
      });
      await ctx.reply(
        `${e("📨", E.AUTOSPAM)} Пост «${label}» принят.\n\nВведите количество дней для постинга (цифрой):`,
        { parse_mode: "HTML" },
      );
      return;
    }

    /* ── Add broadcast post (step 2: enter days) ─────── */
    case "bp_enter_days": {
      if (!state.id || !state.pending) return;
      if (!msg.text || !/^\d+$/.test(msg.text.trim()) || parseInt(msg.text.trim()) < 1) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Введите число дней (целое число ≥ 1):`, { parse_mode: "HTML" });
        return;
      }
      const days = parseInt(msg.text.trim());
      setAwaiting(userId, {
        action: "bp_enter_time",
        id: state.id,
        pending: { ...state.pending, days },
      });

      const kb = new InlineKeyboard();
      if (BOT_USERNAME) {
        const tw = tgwidget(BOT_USERNAME).date({ mode: "time" }).style({ liquidGlass: true, adoptTgPalette: true });
        kb.webApp("Выбрать время", tw.url()).icon(E.SCHEDULE).row();
      }
      kb.text("Отмена", `bp:list:${state.id}`).icon(E.CANCEL).row();

      await ctx.reply(
        `${e("🕓", E.SCHEDULE)} <b>Время постинга</b>\n\n` +
          `Выберите через виджет или введите в формате <code>ЧЧ:ММ</code>:`,
        { reply_markup: kb, parse_mode: "HTML" },
      );
      return;
    }

    /* ── Add broadcast post (step 3: enter time) ─────── */
    case "bp_enter_time": {
      if (!state.id || !state.pending || !state.pending.days) return;

      let time: string | null = null;

      // WebApp data from tgwidget
      if (msg.web_app_data?.data) {
        try {
          const parsed = parseDate(msg.web_app_data.data, { mode: "time" });
          if (parsed?.time) time = parsed.time;
        } catch { /* ignore */ }
      }

      // /start payload from tgwidget
      if (!time && msg.text?.startsWith("/start ")) {
        try {
          const parsed = parseDate(msg.text.slice(7), { mode: "time" });
          if (parsed?.time) time = parsed.time;
        } catch { /* ignore */ }
      }

      // Manual text input (HH:MM)
      if (!time && msg.text) {
        const m = msg.text.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (m?.[1] && m[2]) {
          time = `${m[1].padStart(2, "0")}:${m[2]}`;
        }
      }

      if (!time) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Формат: ЧЧ:ММ (например 09:30) или выберите через виджет.`, { parse_mode: "HTML" });
        return;
      }

      try {
        db.addBroadcastPost(
          state.id,
          state.pending.chatId,
          state.pending.messageId,
          state.pending.label,
          time,
          state.pending.days,
        );
        await ctx.reply(
          `${e("✅", E.CONFIRM)} Пост «${state.pending.label}» добавлен в автоспам.\n` +
            `Дней: ${state.pending.days}, время: ${time}`,
          { parse_mode: "HTML" },
        );
      } catch {
        await ctx.reply(`${e("⚠️", E.WARNING)} Этот пост уже добавлен.`, { parse_mode: "HTML" });
      }
      clearAwaiting(userId);
      await showBroadcastPosts(ctx, state.id, false);
      return;
    }

    /* ── Add plan post ───────────────────────────────────── */
    case "add_plan_post": {
      if (!state.id) return;
      const ppCount = db.getUnsentPlanPosts(state.id).length;
      const label = getPostLabel(msg, ppCount);
      try {
        db.addPlanPost(state.id, String(ctx.chat!.id), msg.message_id, label);
        await ctx.reply(`${e("✅", E.CONFIRM)} Пост «${label}» добавлен в план.`, { parse_mode: "HTML" });
      } catch {
        await ctx.reply(`${e("⚠️", E.WARNING)} Этот пост уже добавлен.`, { parse_mode: "HTML" });
      }
      return; // stay in awaiting mode
    }


  }
}
