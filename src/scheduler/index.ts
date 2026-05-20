import type { Api } from "grammy";
import { parseSchedule } from "tgwidget";
import * as db from "../db";

const POLL_INTERVAL_MS = 60_000; // check every minute
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

  // also run immediately
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
  }
}

/* ═══════════════ Auto-Broadcasts ══════════════════════════ */

async function processBroadcasts(api: Api) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const currentTime = `${hh}:${mm}`;
  const dayIndex = now.getDay(); // 0=Sun..6=Sat → need Mon=0

  const campaigns = db.getActiveCampaigns();

  for (const cmp of campaigns) {
    if (cmp.channel_chat_ids.length === 0) continue;

    let shouldSend = false;

    if (cmp.schedule_type === "simple") {
      shouldSend = cmp.schedule_value === currentTime;
    } else if (cmp.schedule_type === "detailed") {
      try {
        // tgwidget single-28 format: 4 chars per day (Mon..Sun), "9999" = disabled
        const sched = parseSchedule(cmp.schedule_value, { format: "single" });
        // Map JS day (0=Sun) → schedule index (0=Mon)
        const schedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
        const dayConfig = sched[schedIndex];
        if (dayConfig && dayConfig.enabled && dayConfig.time === currentTime) {
          shouldSend = true;
        }
      } catch {
        // Fallback: treat schedule_value as text like "ежедневно 14:30"
        if (cmp.schedule_value.includes(currentTime)) {
          shouldSend = true;
        }
      }
    }

    if (!shouldSend) continue;

    const post = db.pickRandomBroadcastPost(cmp.id);
    if (!post) continue;

    for (const chatId of cmp.channel_chat_ids) {
      try {
        await api.copyMessage(chatId, parseInt(post.chat_id), post.message_id);
        console.log(`[scheduler] broadcast cmp:${cmp.id} post:${post.id} → ${chatId}`);
      } catch (err) {
        console.error(`[scheduler] failed broadcast cmp:${cmp.id} → ${chatId}:`, err);
      }
    }

    db.logBroadcastSend(cmp.id, post.id);
  }
}
