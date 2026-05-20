import type { BotContext } from "../types";
import { isAdmin } from "../utils/admin";
import { e, E } from "../utils/emoji";
import { getAwaiting, clearAwaiting } from "./callbacks";
import { getPostLabel } from "../utils/post-label";
import { showChannelList } from "../menus/channel-menu";
import { showCampaignDetail } from "../menus/campaign-menu";
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

    /* ── Add broadcast post ──────────────────────────────── */
    case "add_broadcast_post": {
      if (!state.id) return;
      const bpCount = db.getBroadcastPosts(state.id).length;
      const label = getPostLabel(msg, bpCount);
      try {
        db.addBroadcastPost(state.id, String(ctx.chat!.id), msg.message_id, label);
        await ctx.reply(`${e("✅", E.CONFIRM)} Пост «${label}» добавлен в автоспам.`, { parse_mode: "HTML" });
      } catch {
        await ctx.reply(`${e("⚠️", E.WARNING)} Этот пост уже добавлен.`, { parse_mode: "HTML" });
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
        await ctx.reply(`${e("✅", E.CONFIRM)} Пост «${label}» добавлен в план.`, { parse_mode: "HTML" });
      } catch {
        await ctx.reply(`${e("⚠️", E.WARNING)} Этот пост уже добавлен.`, { parse_mode: "HTML" });
      }
      return; // stay in awaiting mode
    }


  }
}
