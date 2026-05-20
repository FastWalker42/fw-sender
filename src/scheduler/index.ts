import type { Api } from "grammy";
import { ADMIN_IDS } from "../config";
import { e, E } from "../utils/emoji";
import * as db from "../db";

const POLL_INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(api: Api) {
  if (timer) return;

  console.log("[scheduler] started, polling every 60s");

  timer = setInterval(async () => {
    try {
      await processPlanPosts(api);
      await processBroadcasts(api);
    } catch (err) {
      console.error("[scheduler] error:", err);
    }
  }, POLL_INTERVAL_MS);

  setTimeout(() => {
    processPlanPosts(api).catch(console.error);
    processBroadcasts(api).catch(console.error);
  }, 5000);
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/* ═══════════════ Plan Posts ════════════════════════════════ */

async function processPlanPosts(api: Api) {
  const due = db.getAllDuePlanPosts();
  for (const post of due) {
    for (const chatId of post.channel_chat_ids) {
      try {
        await api.copyMessage(chatId, parseInt(post.chat_id), post.message_id);
        console.log(`[scheduler] plan post ${post.id} → ${chatId}`);
      } catch (err) {
        console.error(`[scheduler] failed plan post ${post.id} → ${chatId}:`, err);
      }
    }
    db.markPlanPostSent(post.id);

    // Notify admins when plan posts remaining hits 3, 2, or 1
    const remaining = db.getUnsentPlanPosts(post.campaign_id).length;
    if (remaining <= 3 && remaining >= 1) {
      const cmp = db.getCampaign(post.campaign_id);
      const cmpName = cmp?.name || `#${post.campaign_id}`;
      const msg =
        `${e("🔔", E.BELL)} <b>Внимание!</b>\n\n` +
        `В плане кампании «${cmpName}» осталось <b>${remaining}</b> ` +
        `${remaining === 1 ? "сообщение" : remaining <= 4 ? "сообщения" : "сообщений"}.`;

      for (const adminId of ADMIN_IDS) {
        try {
          await api.sendMessage(adminId, msg, { parse_mode: "HTML" });
        } catch {
          // admin may not have started the bot yet
        }
      }
    }
  }
}

/* ═══════════════ Autospam (broadcasts) ════════════════════ */

async function processBroadcasts(api: Api) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const currentTime = `${hh}:${mm}`;

  const duePosts = db.getDueBroadcastPosts(currentTime);

  for (const post of duePosts) {
    if (post.channel_chat_ids.length === 0) continue;

    for (const chatId of post.channel_chat_ids) {
      try {
        await api.copyMessage(chatId, parseInt(post.chat_id), post.message_id);
        console.log(`[scheduler] broadcast cmp:${post.campaign_id} post:${post.id} → ${chatId}`);
      } catch (err) {
        console.error(`[scheduler] failed broadcast cmp:${post.campaign_id} → ${chatId}:`, err);
      }
    }

    db.incrementBroadcastDaysSent(post.id);
    db.logBroadcastSend(post.campaign_id, post.id);
  }
}
