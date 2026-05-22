import { InlineKeyboard } from "grammy";
import { tgwidget, parseDate } from "tgwidget";
import type { BotContext } from "../types";
import { BOT_USERNAME } from "../config";
import { isAdmin } from "../utils/admin";
import { e, E } from "../utils/emoji";
import { getAwaiting, clearAwaiting, setAwaiting } from "./callbacks";
import { getPostLabel } from "../utils/post-label";
import { showChannelList } from "../menus/channel-menu";
import {
  showCampaignDetail,
  showBroadcastGroupDetail,
  showBroadcastGroupPostList,
  showPlanPostDetail,
  showUserbotMenu,
} from "../menus/campaign-menu";
import * as db from "../db";
import * as userbot from "../userbot";

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

    /* ── Edit campaign jitter ──────────────────────────────── */
    case "edit_jitter": {
      if (!state.id) return;
      if (!msg.text || !/^\d+$/.test(msg.text.trim())) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Введите число минут (≥ 0):`, { parse_mode: "HTML" });
        return;
      }
      const jitter = parseInt(msg.text.trim());
      db.updateCampaign(state.id, { jitter });
      clearAwaiting(userId);
      await ctx.reply(
        `${e("✅", E.CONFIRM)} Разброс: ${jitter > 0 ? `±${jitter} мин.` : "выключен"}`,
        { parse_mode: "HTML" },
      );
      await showCampaignDetail(ctx, state.id, false);
      return;
    }

    /* ── Name broadcast group ────────────────────────────── */
    case "name_broadcast_group": {
      if (!msg.text || !state.id) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Отправьте текстовое название.`, { parse_mode: "HTML" });
        return;
      }
      setAwaiting(userId, {
        action: "bg_enter_days",
        id: state.id,
        pending: { chatId: "", messageId: 0, label: msg.text.trim() },
      });
      await ctx.reply(
        `${e("📦", E.PACKAGE)} Группа «${msg.text.trim()}».\n\nВведите количество дней для постинга (цифрой):`,
        { parse_mode: "HTML" },
      );
      return;
    }

    /* ── Broadcast group: enter days ─────────────────────── */
    case "bg_enter_days": {
      if (!state.id || !state.pending) return;
      if (!msg.text || !/^\d+$/.test(msg.text.trim()) || parseInt(msg.text.trim()) < 1) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Введите число дней (целое число ≥ 1):`, { parse_mode: "HTML" });
        return;
      }
      const days = parseInt(msg.text.trim());
      setAwaiting(userId, {
        action: "bg_enter_time",
        id: state.id,
        pending: { ...state.pending, days },
      });

      const kb = new InlineKeyboard();
      if (BOT_USERNAME) {
        const tw = tgwidget(BOT_USERNAME).date({ mode: "time" }).style({ liquidGlass: true, adoptTgPalette: true });
        kb.webApp("Выбрать время", tw.url()).icon(E.SCHEDULE).row();
      }
      kb.text("Отмена", `bg:list:${state.id}`).icon(E.CANCEL).row();

      await ctx.reply(
        `${e("🕓", E.SCHEDULE)} <b>Время постинга</b>\n\n` +
          `Выберите через виджет или введите в формате <code>ЧЧ:ММ</code>:`,
        { reply_markup: kb, parse_mode: "HTML" },
      );
      return;
    }

    /* ── Broadcast group: enter time ─────────────────────── */
    case "bg_enter_time": {
      if (!state.id || !state.pending || !state.pending.days) return;

      let time: string | null = null;

      if (msg.web_app_data?.data) {
        try {
          const parsed = parseDate(msg.web_app_data.data, { mode: "time" });
          if (parsed?.time) time = parsed.time;
        } catch { /* ignore */ }
      }

      if (!time && msg.text?.startsWith("/start ")) {
        try {
          const parsed = parseDate(msg.text.slice(7), { mode: "time" });
          if (parsed?.time) time = parsed.time;
        } catch { /* ignore */ }
      }

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

      const newGroup = db.addBroadcastGroup(
        state.id,
        state.pending.label,
        time,
        state.pending.days,
      );
      clearAwaiting(userId);
      await ctx.reply(`${e("✅", E.CONFIRM)} Группа «${newGroup.label}» создана.`, { parse_mode: "HTML" });
      await showBroadcastGroupDetail(ctx, newGroup.id);
      return;
    }

    /* ── Edit remaining days for broadcast group ───────────── */
    case "edit_broadcast_days": {
      if (!state.id) return;
      if (!msg.text || !/^\d+$/.test(msg.text.trim()) || parseInt(msg.text.trim()) < 0) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Введите число (≥ 0):`, { parse_mode: "HTML" });
        return;
      }
      const newRemaining = parseInt(msg.text.trim());
      const group = db.getBroadcastGroup(state.id);
      if (!group) return;
      // remaining = total_days - days_sent → total_days = days_sent + newRemaining
      const newTotalDays = group.days_sent + newRemaining;
      db.updateBroadcastGroup(state.id, { total_days: newTotalDays });
      clearAwaiting(userId);
      await ctx.reply(`${e("✅", E.CONFIRM)} Осталось дней: ${newRemaining}`, { parse_mode: "HTML" });
      await showBroadcastGroupDetail(ctx, state.id);
      return;
    }

    /* ── Add post to broadcast group ─────────────────────── */
    case "add_group_post": {
      if (!state.id) return;
      const count = db.countBroadcastGroupPosts(state.id);
      const label = getPostLabel(msg, count);

      try {
        const newPost = db.addBroadcastGroupPost(
          state.id,
          String(ctx.chat!.id),
          msg.message_id,
          label,
        );
        clearAwaiting(userId);
        await ctx.reply(`${e("✅", E.CONFIRM)} Пост «${newPost.label}» добавлен в группу.`, { parse_mode: "HTML" });
        await showBroadcastGroupPostList(ctx, state.id);
      } catch {
        await ctx.reply(`${e("⚠️", E.WARNING)} Этот пост уже добавлен.`, { parse_mode: "HTML" });
        clearAwaiting(userId);
      }
      return;
    }

    /* ── Add plan post (step 1: receive post) ──────────── */
    case "add_plan_post": {
      if (!state.id) return;
      const ppCount = db.getUnsentPlanPosts(state.id).length;
      const ppLabel = getPostLabel(msg, ppCount);
      setAwaiting(userId, {
        action: "pp_enter_time",
        id: state.id,
        pending: { chatId: String(ctx.chat!.id), messageId: msg.message_id, label: ppLabel },
      });

      const ppKb = new InlineKeyboard();
      if (BOT_USERNAME) {
        const tw = tgwidget(BOT_USERNAME).date({ mode: "time" }).style({ liquidGlass: true, adoptTgPalette: true });
        ppKb.webApp("Выбрать время", tw.url()).icon(E.SCHEDULE).row();
      }
      ppKb.text("Отмена", `pp:list:${state.id}`).icon(E.CANCEL).row();

      await ctx.reply(
        `${e("📥", E.PLAN)} Пост «${ppLabel}» принят.\n\n` +
          `${e("🕓", E.SCHEDULE)} <b>Время постинга</b>\n` +
          `Выберите через виджет или введите в формате <code>ЧЧ:ММ</code>:`,
        { reply_markup: ppKb, parse_mode: "HTML" },
      );
      return;
    }

    /* ── Add plan post (step 2: enter time) ──────────── */
    case "pp_enter_time": {
      if (!state.id || !state.pending) return;

      let ppTime: string | null = null;

      if (msg.web_app_data?.data) {
        try {
          const parsed = parseDate(msg.web_app_data.data, { mode: "time" });
          if (parsed?.time) ppTime = parsed.time;
        } catch { /* ignore */ }
      }

      if (!ppTime && msg.text?.startsWith("/start ")) {
        try {
          const parsed = parseDate(msg.text.slice(7), { mode: "time" });
          if (parsed?.time) ppTime = parsed.time;
        } catch { /* ignore */ }
      }

      if (!ppTime && msg.text) {
        const tm = msg.text.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (tm?.[1] && tm[2]) {
          ppTime = `${tm[1].padStart(2, "0")}:${tm[2]}`;
        }
      }

      if (!ppTime) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Формат: ЧЧ:ММ (например 09:30) или выберите через виджет.`, { parse_mode: "HTML" });
        return;
      }

      let newPlanPost;
      try {
        newPlanPost = db.addPlanPost(state.id, state.pending.chatId, state.pending.messageId, state.pending.label);
        db.updatePlanPost(newPlanPost.id, { send_time: ppTime });
      } catch {
        await ctx.reply(`${e("⚠️", E.WARNING)} Этот пост уже добавлен.`, { parse_mode: "HTML" });
        clearAwaiting(userId);
        return;
      }
      clearAwaiting(userId);
      await showPlanPostDetail(ctx, newPlanPost.id);
      return;
    }

    /* ── Userbot: enter phone ────────────────────────────── */
    case "ub_phone": {
      if (!msg.text) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Введите номер телефона.`, { parse_mode: "HTML" });
        return;
      }
      const phone = msg.text.trim();
      try {
        await userbot.sendCode(phone);
        setAwaiting(userId, { action: "ub_code" });
        await ctx.reply(
          `${e("🔓", E.LOCK)} Код отправлен на <b>${phone}</b>.\n\nВведите код из Telegram:`,
          { parse_mode: "HTML" },
        );
      } catch (err: any) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Ошибка: ${err?.message || err}`, { parse_mode: "HTML" });
        clearAwaiting(userId);
      }
      return;
    }

    /* ── Userbot: enter code ─────────────────────────────── */
    case "ub_code": {
      if (!msg.text) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Введите код.`, { parse_mode: "HTML" });
        return;
      }
      try {
        const name = await userbot.signIn(msg.text.trim());
        clearAwaiting(userId);
        await ctx.reply(
          `${e("✅", E.CONFIRM)} Юзербот подключён как <b>${name}</b>`,
          { parse_mode: "HTML" },
        );
        await showUserbotMenu(ctx, false);
      } catch (err: any) {
        if (err?.message === "2FA_REQUIRED") {
          setAwaiting(userId, { action: "ub_password" });
          await ctx.reply(
            `${e("🔓", E.LOCK)} Аккаунт защищён 2FA. Введите пароль:`,
            { parse_mode: "HTML" },
          );
        } else {
          await ctx.reply(`${e("⚠️", E.WARNING)} Ошибка: ${err?.message || err}`, { parse_mode: "HTML" });
          clearAwaiting(userId);
        }
      }
      return;
    }

    /* ── Userbot: enter 2FA password ─────────────────────── */
    case "ub_password": {
      if (!msg.text) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Введите пароль.`, { parse_mode: "HTML" });
        return;
      }
      try {
        const name = await userbot.checkPassword(msg.text.trim());
        clearAwaiting(userId);
        await ctx.reply(
          `${e("✅", E.CONFIRM)} Юзербот подключён как <b>${name}</b>`,
          { parse_mode: "HTML" },
        );
        await showUserbotMenu(ctx, false);
      } catch (err: any) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Ошибка: ${err?.message || err}`, { parse_mode: "HTML" });
        clearAwaiting(userId);
      }
      return;
    }

    /* ── Userbot: import session string ──────────────────── */
    case "ub_import_session": {
      if (!msg.text) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Отправьте строку сессии текстом.`, { parse_mode: "HTML" });
        return;
      }
      try {
        const name = await userbot.importStringSession(msg.text.trim());
        clearAwaiting(userId);
        await ctx.reply(
          `${e("✅", E.CONFIRM)} Юзербот подключён как <b>${name}</b>`,
          { parse_mode: "HTML" },
        );
        await showUserbotMenu(ctx, false);
      } catch (err: any) {
        await ctx.reply(`${e("⚠️", E.WARNING)} Ошибка импорта: ${err?.message || err}`, { parse_mode: "HTML" });
        clearAwaiting(userId);
      }
      return;
    }


  }
}
