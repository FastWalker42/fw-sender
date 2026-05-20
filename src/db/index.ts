import { Database } from "bun:sqlite";
import type {
  Channel,
  Campaign,
  BroadcastPost,
  BroadcastSendLog,
  PlanPost,
} from "../types";

const db = new Database("fw-sender.db", { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

/* ═══════════════════════════ DDL ═══════════════════════════ */

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id  TEXT UNIQUE NOT NULL,
      title    TEXT NOT NULL DEFAULT '',
      username TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT    NOT NULL DEFAULT 'Кампания',
      schedule_type  TEXT    NOT NULL DEFAULT 'simple',
      schedule_value TEXT    NOT NULL DEFAULT '12:00',
      default_time   TEXT    NOT NULL DEFAULT '12:00',
      is_active      INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_channels (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      channel_id  INTEGER NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id)  REFERENCES channels(id)  ON DELETE CASCADE,
      UNIQUE(campaign_id, channel_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcast_posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      chat_id     TEXT    NOT NULL,
      message_id  INTEGER NOT NULL,
      label       TEXT    NOT NULL DEFAULT 'Пост',
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      UNIQUE(chat_id, message_id, campaign_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcast_send_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      post_id     INTEGER NOT NULL,
      sent_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id)     REFERENCES broadcast_posts(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_posts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id  INTEGER NOT NULL,
      chat_id      TEXT    NOT NULL,
      message_id   INTEGER NOT NULL,
      label        TEXT    NOT NULL DEFAULT 'Пост',
      send_date    TEXT,
      send_time    TEXT,
      is_auto_time INTEGER NOT NULL DEFAULT 0,
      is_sent      INTEGER NOT NULL DEFAULT 0,
      position     INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      UNIQUE(chat_id, message_id, campaign_id)
    )
  `);
}

/* ═══════════════════════ Channels ══════════════════════════ */

export function getAllChannels(): Channel[] {
  return db.query("SELECT * FROM channels ORDER BY id").all() as Channel[];
}

export function getChannel(id: number): Channel | null {
  return db.query("SELECT * FROM channels WHERE id = ?").get(id) as Channel | null;
}

export function getChannelByChatId(chatId: string): Channel | null {
  return db.query("SELECT * FROM channels WHERE chat_id = ?").get(chatId) as Channel | null;
}

export function addChannel(chatId: string, title: string, username: string | null): Channel {
  db.query("INSERT INTO channels (chat_id, title, username) VALUES (?, ?, ?)").run(chatId, title, username);
  return getChannelByChatId(chatId)!;
}

export function removeChannel(id: number) {
  db.query("DELETE FROM channels WHERE id = ?").run(id);
}

/* ═══════════════════════ Campaigns ═════════════════════════ */

export function getAllCampaigns(): Campaign[] {
  return db.query("SELECT * FROM campaigns ORDER BY id").all() as Campaign[];
}

export function getCampaign(id: number): Campaign | null {
  return db.query("SELECT * FROM campaigns WHERE id = ?").get(id) as Campaign | null;
}

export function addCampaign(name: string): Campaign {
  const r = db.query("INSERT INTO campaigns (name) VALUES (?)").run(name);
  return getCampaign(Number(r.lastInsertRowid))!;
}

export function updateCampaign(
  id: number,
  f: Partial<Pick<Campaign, "name" | "schedule_type" | "schedule_value" | "default_time" | "is_active">>,
) {
  const s: string[] = [];
  const v: (string | number)[] = [];
  if (f.name !== undefined) { s.push("name = ?"); v.push(f.name); }
  if (f.schedule_type !== undefined) { s.push("schedule_type = ?"); v.push(f.schedule_type); }
  if (f.schedule_value !== undefined) { s.push("schedule_value = ?"); v.push(f.schedule_value); }
  if (f.default_time !== undefined) { s.push("default_time = ?"); v.push(f.default_time); }
  if (f.is_active !== undefined) { s.push("is_active = ?"); v.push(f.is_active); }
  if (s.length === 0) return;
  v.push(id);
  db.query(`UPDATE campaigns SET ${s.join(", ")} WHERE id = ?`).run(...v);
}

export function removeCampaign(id: number) {
  db.query("DELETE FROM campaigns WHERE id = ?").run(id);
}

/* ═══════════════ Campaign ↔ Channels (m2m) ═════════════════ */

export function getCampaignChannels(campaignId: number): Channel[] {
  return db.query(
    `SELECT c.* FROM channels c
     JOIN campaign_channels cc ON cc.channel_id = c.id
     WHERE cc.campaign_id = ? ORDER BY c.id`,
  ).all(campaignId) as Channel[];
}

export function getChannelsNotInCampaign(campaignId: number): Channel[] {
  return db.query(
    `SELECT c.* FROM channels c
     WHERE c.id NOT IN (SELECT channel_id FROM campaign_channels WHERE campaign_id = ?)
     ORDER BY c.id`,
  ).all(campaignId) as Channel[];
}

export function linkChannel(campaignId: number, channelId: number) {
  db.query("INSERT OR IGNORE INTO campaign_channels (campaign_id, channel_id) VALUES (?, ?)").run(campaignId, channelId);
}

export function unlinkChannel(campaignId: number, channelId: number) {
  db.query("DELETE FROM campaign_channels WHERE campaign_id = ? AND channel_id = ?").run(campaignId, channelId);
}

/* ═══════════════ Broadcast Posts (auto-broadcast) ══════════ */

export function getBroadcastPosts(campaignId: number): BroadcastPost[] {
  return db.query("SELECT * FROM broadcast_posts WHERE campaign_id = ? ORDER BY position").all(campaignId) as BroadcastPost[];
}

export function getBroadcastPost(id: number): BroadcastPost | null {
  return db.query("SELECT * FROM broadcast_posts WHERE id = ?").get(id) as BroadcastPost | null;
}

export function addBroadcastPost(campaignId: number, chatId: string, messageId: number, label: string): BroadcastPost {
  const mx = db.query("SELECT COALESCE(MAX(position),-1) as m FROM broadcast_posts WHERE campaign_id = ?").get(campaignId) as { m: number };
  const r = db.query(
    "INSERT INTO broadcast_posts (campaign_id, chat_id, message_id, label, position) VALUES (?,?,?,?,?)",
  ).run(campaignId, chatId, messageId, label, mx.m + 1);
  return getBroadcastPost(Number(r.lastInsertRowid))!;
}

export function removeBroadcastPost(id: number) {
  db.query("DELETE FROM broadcast_posts WHERE id = ?").run(id);
}

/* ═══════════ Broadcast Send Log (no-repeat random) ═════════ */

export function logBroadcastSend(campaignId: number, postId: number) {
  db.query("INSERT INTO broadcast_send_log (campaign_id, post_id) VALUES (?,?)").run(campaignId, postId);
}

export function getRecentSendLog(campaignId: number, limit: number): BroadcastSendLog[] {
  return db.query(
    "SELECT * FROM broadcast_send_log WHERE campaign_id = ? ORDER BY id DESC LIMIT ?",
  ).all(campaignId, limit) as BroadcastSendLog[];
}

export function pickRandomBroadcastPost(campaignId: number): BroadcastPost | null {
  const posts = getBroadcastPosts(campaignId);
  if (posts.length === 0) return null;
  if (posts.length === 1) return posts[0] ?? null;

  const recent = getRecentSendLog(campaignId, posts.length - 1);
  const recentIds = new Set(recent.map((r) => r.post_id));
  const eligible = posts.filter((p) => !recentIds.has(p.id));

  if (eligible.length === 0) return posts[Math.floor(Math.random() * posts.length)] ?? null;
  return eligible[Math.floor(Math.random() * eligible.length)] ?? null;
}

/* ═══════════════════ Plan Posts ═════════════════════════════ */

export function getPlanPosts(campaignId: number): PlanPost[] {
  return db.query("SELECT * FROM plan_posts WHERE campaign_id = ? ORDER BY position").all(campaignId) as PlanPost[];
}

export function getUnsentPlanPosts(campaignId: number): PlanPost[] {
  return db.query(
    "SELECT * FROM plan_posts WHERE campaign_id = ? AND is_sent = 0 ORDER BY position",
  ).all(campaignId) as PlanPost[];
}

export function getPlanPost(id: number): PlanPost | null {
  return db.query("SELECT * FROM plan_posts WHERE id = ?").get(id) as PlanPost | null;
}

export function addPlanPost(campaignId: number, chatId: string, messageId: number, label: string): PlanPost {
  const mx = db.query("SELECT COALESCE(MAX(position),-1) as m FROM plan_posts WHERE campaign_id = ?").get(campaignId) as { m: number };
  const r = db.query(
    "INSERT INTO plan_posts (campaign_id, chat_id, message_id, label, position) VALUES (?,?,?,?,?)",
  ).run(campaignId, chatId, messageId, label, mx.m + 1);
  return getPlanPost(Number(r.lastInsertRowid))!;
}

export function updatePlanPost(
  id: number,
  f: Partial<Pick<PlanPost, "send_date" | "send_time" | "is_auto_time" | "is_sent" | "label" | "position">>,
) {
  const s: string[] = [];
  const v: (string | number | null)[] = [];
  if (f.send_date !== undefined) { s.push("send_date = ?"); v.push(f.send_date); }
  if (f.send_time !== undefined) { s.push("send_time = ?"); v.push(f.send_time); }
  if (f.is_auto_time !== undefined) { s.push("is_auto_time = ?"); v.push(f.is_auto_time); }
  if (f.is_sent !== undefined) { s.push("is_sent = ?"); v.push(f.is_sent); }
  if (f.label !== undefined) { s.push("label = ?"); v.push(f.label); }
  if (f.position !== undefined) { s.push("position = ?"); v.push(f.position); }
  if (s.length === 0) return;
  v.push(id);
  db.query(`UPDATE plan_posts SET ${s.join(", ")} WHERE id = ?`).run(...v);
}

export function removePlanPost(id: number) {
  db.query("DELETE FROM plan_posts WHERE id = ?").run(id);
}

export function markPlanPostSent(id: number) {
  db.query("UPDATE plan_posts SET is_sent = 1 WHERE id = ?").run(id);
}

/** All due plan posts across all active campaigns */
export function getAllDuePlanPosts(): (PlanPost & { channel_chat_ids: string[] })[] {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const rows = db.query(`
    SELECT pp.*
    FROM plan_posts pp
    JOIN campaigns cmp ON cmp.id = pp.campaign_id
    WHERE pp.is_sent = 0
      AND cmp.is_active = 1
      AND pp.send_date IS NOT NULL
      AND pp.send_time IS NOT NULL
      AND (pp.send_date < ? OR (pp.send_date = ? AND pp.send_time <= ?))
    ORDER BY pp.send_date, pp.send_time
  `).all(date, date, time) as PlanPost[];

  return rows.map((pp) => {
    const channels = getCampaignChannels(pp.campaign_id);
    return { ...pp, channel_chat_ids: channels.map((c) => c.chat_id) };
  });
}

/** All active campaigns with their channel chat_ids (for scheduler) */
export function getActiveCampaigns(): (Campaign & { channel_chat_ids: string[] })[] {
  const campaigns = db.query("SELECT * FROM campaigns WHERE is_active = 1").all() as Campaign[];
  return campaigns.map((c) => ({
    ...c,
    channel_chat_ids: getCampaignChannels(c.id).map((ch) => ch.chat_id),
  }));
}

export { db };
