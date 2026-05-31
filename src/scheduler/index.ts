import type { Api } from "grammy";
import { ADMIN_IDS } from "../config";
import { e, E } from "../utils/emoji";
import * as db from "../db";
import * as userbot from "../userbot";

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

/**
 * Send a post (single message or media group / album) to a channel.
 * Uses `copyMessages` (plural) when there are multiple message_ids
 * so that media groups are sent as a single album.
 */
async function sendToChannel(api: Api, chatId: string, fromChatId: string, messageIds: number[]): Promise<void> {
  if (messageIds.length === 0) return;

  if (userbot.isLoggedIn() && userbot.isBotRelayReady()) {
    const ubId = userbot.getUserbotId();
    if (ubId) {
      // 1. Bot copies the post(s) to userbot's DM
      if (messageIds.length === 1) {
        await api.copyMessage(ubId, parseInt(fromChatId), messageIds[0]!);
      } else {
        await api.copyMessages(ubId, parseInt(fromChatId), messageIds);
      }
      // 2. Userbot gets latest msg(s) from bot DM and forwards to channel
      await userbot.relayViaBot(chatId, messageIds.length);
      // 3. Relay marker for audit trail (non-critical)
      try {
        // Get the last copied message id for the relay marker reply
        const copiedMsgId = await api.sendMessage(ubId, `relay → ${chatId}`);
        // no-op: just a marker
        void copiedMsgId;
      } catch { /* non-critical */ }
      return;
    }
  }

  // Fallback: direct Bot API copy (no userbot relay)
  if (messageIds.length === 1) {
    await api.copyMessage(chatId, parseInt(fromChatId), messageIds[0]!);
  } else {
    await api.copyMessages(chatId, parseInt(fromChatId), messageIds);
  }
}

/* ═══════════════ Plan Posts ════════════════════════════════ */

async function processPlanPosts(api: Api) {
  const due = db.getAllDuePlanPosts();
  for (const post of due) {
    const messageIds = db.parseMessageIds(post);
    for (const chatId of post.channel_chat_ids) {
      try {
        await sendToChannel(api, chatId, post.chat_id, messageIds);
        console.log(`[scheduler] plan post ${post.id} → ${chatId}`);
      } catch (err) {
        console.error(`[scheduler] failed plan post ${post.id} → ${chatId}:`, err);
      }
    }
    db.markPlanPostSent(post.id);

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
  const weekday = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  const dueGroups = db.getDueBroadcastGroups(currentTime, weekday);

  for (const group of dueGroups) {
    if (group.channel_chat_ids.length === 0) continue;

    // Dedup: skip if already sent today (e.g. after restart within same minute)
    if (db.wasBroadcastGroupSentToday(group.id)) continue;

    const post = db.pickRandomGroupPost(group);
    if (!post) {
      console.log(`[scheduler] broadcast group:${group.id} has no posts, skipping`);
      continue;
    }

    const messageIds = db.parseMessageIds(post);

    for (const chatId of group.channel_chat_ids) {
      try {
        await sendToChannel(api, chatId, post.chat_id, messageIds);
        console.log(`[scheduler] broadcast cmp:${group.campaign_id} group:${group.id} post:${post.id} → ${chatId}`);
      } catch (err) {
        console.error(`[scheduler] failed broadcast cmp:${group.campaign_id} group:${group.id} → ${chatId}:`, err);
      }
    }

    db.updateBroadcastGroup(group.id, { last_post_id: post.id });
    db.incrementBroadcastGroupDaysSent(group.id);
    db.logBroadcastSend(group.campaign_id, group.id, post.id);
  }
}
