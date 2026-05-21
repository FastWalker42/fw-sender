import { Database } from "bun:sqlite";
import type {
  Channel,
  Campaign,
  BroadcastGroup,
  BroadcastGroupPost,
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

  // ── Broadcast groups (replaces broadcast_posts) ─────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcast_groups (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id     INTEGER NOT NULL,
      label           TEXT    NOT NULL DEFAULT 'Группа',
      position        INTEGER NOT NULL DEFAULT 0,
      send_time       TEXT    NOT NULL DEFAULT '12:00',
      schedule_type   TEXT    NOT NULL DEFAULT 'simple',
      schedule_value  TEXT    NOT NULL DEFAULT '',
      total_days      INTEGER NOT NULL DEFAULT 1,
      days_sent       INTEGER NOT NULL DEFAULT 0,
      last_post_id    INTEGER,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcast_group_posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id   INTEGER NOT NULL,
      chat_id    TEXT    NOT NULL,
      message_id INTEGER NOT NULL,
      label      TEXT    NOT NULL DEFAULT 'Пост',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (group_id) REFERENCES broadcast_groups(id) ON DELETE CASCADE,
      UNIQUE(group_id, chat_id, message_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcast_send_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      group_id    INTEGER NOT NULL,
      post_id     INTEGER NOT NULL,
      sent_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id)    REFERENCES broadcast_groups(id) ON DELETE CASCADE
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

  // Migrate: drop old broadcast_posts if it exists (one-time migration)
  const oldTable = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='broadcast_posts'",
  ).get();
  if (oldTable) {
    db.exec("DROP TABLE IF EXISTS broadcast_posts");
    console.log("[db] migrated: dropped old broadcast_posts table");
  }

  // Migrate: add schedule_type/schedule_value columns to broadcast_groups if missing
  const bgCols = db.query("PRAGMA table_info(broadcast_groups)").all() as { name: string }[];
  if (bgCols.length > 0 && !bgCols.some((c) => c.name === "schedule_type")) {
    db.exec("ALTER TABLE broadcast_groups ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'simple'");
    db.exec("ALTER TABLE broadcast_groups ADD COLUMN schedule_value TEXT NOT NULL DEFAULT ''");
    console.log("[db] migrated: added schedule_type/schedule_value to broadcast_groups");
  }

  // Migrate: recreate broadcast_send_log if it has old schema (no group_id column)
  const logCols = db.query("PRAGMA table_info(broadcast_send_log)").all() as { name: string }[];
  const hasGroupId = logCols.some((c) => c.name === "group_id");
  if (!hasGroupId && logCols.length > 0) {
    db.exec("DROP TABLE broadcast_send_log");
    db.exec(`
      CREATE TABLE broadcast_send_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL,
        group_id    INTEGER NOT NULL,
        post_id     INTEGER NOT NULL,
        sent_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id)    REFERENCES broadcast_groups(id) ON DELETE CASCADE
      )
    `);
    console.log("[db] migrated: recreated broadcast_send_log with group_id column");
  }
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

/* ═══════════════ Broadcast Groups ══════════════════════════ */

export function getBroadcastGroups(campaignId: number): BroadcastGroup[] {
  return db.query("SELECT * FROM broadcast_groups WHERE campaign_id = ? ORDER BY position").all(campaignId) as BroadcastGroup[];
}

export function getBroadcastGroup(id: number): BroadcastGroup | null {
  return db.query("SELECT * FROM broadcast_groups WHERE id = ?").get(id) as BroadcastGroup | null;
}

export function addBroadcastGroup(
  campaignId: number,
  label: string,
  sendTime: string,
  totalDays: number,
): BroadcastGroup {
  const mx = db.query("SELECT COALESCE(MAX(position),-1) as m FROM broadcast_groups WHERE campaign_id = ?").get(campaignId) as { m: number };
  const r = db.query(
    "INSERT INTO broadcast_groups (campaign_id, label, position, send_time, total_days) VALUES (?,?,?,?,?)",
  ).run(campaignId, label, mx.m + 1, sendTime, totalDays);
  return getBroadcastGroup(Number(r.lastInsertRowid))!;
}

export function updateBroadcastGroup(
  id: number,
  f: Partial<Pick<BroadcastGroup, "send_time" | "schedule_type" | "schedule_value" | "total_days" | "days_sent" | "label" | "position" | "last_post_id">>,
) {
  const s: string[] = [];
  const v: (string | number | null)[] = [];
  if (f.send_time !== undefined) { s.push("send_time = ?"); v.push(f.send_time); }
  if (f.schedule_type !== undefined) { s.push("schedule_type = ?"); v.push(f.schedule_type); }
  if (f.schedule_value !== undefined) { s.push("schedule_value = ?"); v.push(f.schedule_value); }
  if (f.total_days !== undefined) { s.push("total_days = ?"); v.push(f.total_days); }
  if (f.days_sent !== undefined) { s.push("days_sent = ?"); v.push(f.days_sent); }
  if (f.label !== undefined) { s.push("label = ?"); v.push(f.label); }
  if (f.position !== undefined) { s.push("position = ?"); v.push(f.position); }
  if (f.last_post_id !== undefined) { s.push("last_post_id = ?"); v.push(f.last_post_id); }
  if (s.length === 0) return;
  v.push(id);
  db.query(`UPDATE broadcast_groups SET ${s.join(", ")} WHERE id = ?`).run(...v);
}

export function incrementBroadcastGroupDaysSent(id: number) {
  db.query("UPDATE broadcast_groups SET days_sent = days_sent + 1 WHERE id = ?").run(id);
}

export function removeBroadcastGroup(id: number) {
  db.query("DELETE FROM broadcast_groups WHERE id = ?").run(id);
}

/* ═══════════════ Broadcast Group Posts ═════════════════════ */

export function getBroadcastGroupPosts(groupId: number): BroadcastGroupPost[] {
  return db.query("SELECT * FROM broadcast_group_posts WHERE group_id = ? ORDER BY id").all(groupId) as BroadcastGroupPost[];
}

export function getBroadcastGroupPost(id: number): BroadcastGroupPost | null {
  return db.query("SELECT * FROM broadcast_group_posts WHERE id = ?").get(id) as BroadcastGroupPost | null;
}

export function addBroadcastGroupPost(groupId: number, chatId: string, messageId: number, label: string): BroadcastGroupPost {
  const r = db.query(
    "INSERT INTO broadcast_group_posts (group_id, chat_id, message_id, label) VALUES (?,?,?,?)",
  ).run(groupId, chatId, messageId, label);
  return getBroadcastGroupPost(Number(r.lastInsertRowid))!;
}

export function removeBroadcastGroupPost(id: number) {
  db.query("DELETE FROM broadcast_group_posts WHERE id = ?").run(id);
}

export function countBroadcastGroupPosts(groupId: number): number {
  const row = db.query("SELECT COUNT(*) as cnt FROM broadcast_group_posts WHERE group_id = ?").get(groupId) as { cnt: number };
  return row.cnt;
}

/* ═══════════ Broadcast Send Log ════════════════════════════ */

export function logBroadcastSend(campaignId: number, groupId: number, postId: number) {
  db.query("INSERT INTO broadcast_send_log (campaign_id, group_id, post_id) VALUES (?,?,?)").run(campaignId, groupId, postId);
}

/** Check if a broadcast group has already been sent today */
export function wasBroadcastGroupSentToday(groupId: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.query(
    "SELECT 1 FROM broadcast_send_log WHERE group_id = ? AND sent_at >= ? LIMIT 1",
  ).get(groupId, today + " 00:00:00") as { 1: number } | null;
  return row !== null;
}

/** All due broadcast groups across all active campaigns for current time */
export function getDueBroadcastGroups(currentTime: string, weekday: number): (BroadcastGroup & { channel_chat_ids: string[] })[] {
  // Fetch all active groups that haven't exceeded total_days
  const rows = db.query(`
    SELECT bg.*
    FROM broadcast_groups bg
    JOIN campaigns cmp ON cmp.id = bg.campaign_id
    WHERE cmp.is_active = 1
      AND bg.days_sent < bg.total_days
    ORDER BY bg.campaign_id, bg.position
  `).all() as BroadcastGroup[];

  // Filter by schedule
  const due = rows.filter((bg) => {
    if (bg.schedule_type === "detailed" && bg.schedule_value) {
      const dayTime = getScheduleTimeForDay(bg.schedule_value, weekday);
      return dayTime === currentTime;
    }
    return bg.send_time === currentTime;
  });

  return due.map((bg) => {
    const channels = getCampaignChannels(bg.campaign_id);
    return { ...bg, channel_chat_ids: channels.map((c) => c.chat_id) };
  });
}

/**
 * Extract time for a specific weekday from 28-char tgwidget single schedule.
 * Format: 7 × 4-char blocks (HHMM), "9999" = disabled.
 * Weekday: 0=Mon, 1=Tue, ..., 6=Sun (JS getDay() returns 0=Sun, so we remap).
 */
export function getScheduleTimeForDay(scheduleValue: string, jsWeekday: number): string | null {
  // JS weekday: 0=Sun,1=Mon,...,6=Sat → tgwidget: 0=Mon,...,6=Sun
  const idx = jsWeekday === 0 ? 6 : jsWeekday - 1;
  const offset = idx * 4;
  const block = scheduleValue.slice(offset, offset + 4);
  if (!block || block.length < 4 || block === "9999") return null;
  const hh = block.slice(0, 2);
  const mm = block.slice(2, 4);
  return `${hh}:${mm}`;
}

/** Pick a random post from group, avoiding the last_post_id */
export function pickRandomGroupPost(group: BroadcastGroup): BroadcastGroupPost | null {
  const posts = getBroadcastGroupPosts(group.id);
  if (posts.length === 0) return null;
  if (posts.length === 1) return posts[0]!;

  const eligible = posts.filter((p) => p.id !== group.last_post_id);
  if (eligible.length === 0) return posts[0]!;
  return eligible[Math.floor(Math.random() * eligible.length)]!;
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
