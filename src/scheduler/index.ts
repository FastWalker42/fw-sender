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

async function sendToChannel(api: Api, chatId: string, fromChatId: string, messageId: number): Promise<void> {
  if (userbot.isLoggedIn() && userbot.isBotRelayReady()) {
    const ubId = userbot.getUserbotId();
    if (ubId) {
      // Bot copies the post to userbot's DM, then userbot forwards to channel
      const copied = await api.copyMessage(ubId, parseInt(fromChatId), messageId);
      try {
        await api.sendMessage(ubId, `relay → ${chatId}`, {
          reply_parameters: { message_id: copied.message_id },
        });
      } catch { /* relay marker is non-critical */ }
      await userbot.relayViaBot(copied.message_id, chatId);
      return;
    }
  }
  await api.copyMessage(chatId, parseInt(fromChatId), messageId);
}

/* ═══════════════ Plan Posts ════════════════════════════════ */

async function processPlanPosts(api: Api) {
  const due = db.getAllDuePlanPosts();
  for (const post of due) {
    for (const chatId of post.channel_chat_ids) {
      try {
        await sendToChannel(api, chatId, post.chat_id, post.message_id);
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

  const dueGroups = db.getDueBroadcastGroups(currentTime);

  for (const group of dueGroups) {
    if (group.channel_chat_ids.length === 0) continue;

    const post = db.pickRandomGroupPost(group);
    if (!post) {
      console.log(`[scheduler] broadcast group:${group.id} has no posts, skipping`);
      continue;
    }

    for (const chatId of group.channel_chat_ids) {
      try {
        await sendToChannel(api, chatId, post.chat_id, post.message_id);
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
