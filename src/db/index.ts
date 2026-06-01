import { Database } from "bun:sqlite";
import type {
  Channel,
  ChannelTarget,
  Campaign,
  BroadcastGroup,
  BroadcastGroupPost,
  PlanPost,
} from "../types";
import type { ScheduleDay } from "tgwidget";
import { parseSchedule } from "tgwidget";
import { getJitterOffset, addMinutesToTime } from "../utils/jitter";

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
      jitter         INTEGER NOT NULL DEFAULT 0,
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

  // Migrate: add jitter column to campaigns if missing
  const cmpCols = db.query("PRAGMA table_info(campaigns)").all() as { name: string }[];
  if (cmpCols.length > 0 && !cmpCols.some((c) => c.name === "jitter")) {
    db.exec("ALTER TABLE campaigns ADD COLUMN jitter INTEGER NOT NULL DEFAULT 0");
    console.log("[db] migrated: added jitter to campaigns");
  }

  // Migrate: add auto_approve column to channels if missing
  const chCols = db.query("PRAGMA table_info(channels)").all() as { name: string }[];
  if (chCols.length > 0 && !chCols.some((c) => c.name === "auto_approve")) {
    db.exec("ALTER TABLE channels ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0");
    console.log("[db] migrated: added auto_approve to channels");
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

  // Migrate: add message_ids column to broadcast_group_posts
  const bgpCols = db.query("PRAGMA table_info(broadcast_group_posts)").all() as { name: string }[];
  if (bgpCols.length > 0 && !bgpCols.some((c) => c.name === "message_ids")) {
    db.exec("ALTER TABLE broadcast_group_posts ADD COLUMN message_ids TEXT");
    // Backfill: set message_ids = json_array(message_id) for existing rows
    db.exec("UPDATE broadcast_group_posts SET message_ids = json_array(message_id) WHERE message_ids IS NULL");
    console.log("[db] migrated: added message_ids to broadcast_group_posts");
  }

  // Migrate: add message_ids column to plan_posts
  const ppCols = db.query("PRAGMA table_info(plan_posts)").all() as { name: string }[];
  if (ppCols.length > 0 && !ppCols.some((c) => c.name === "message_ids")) {
    db.exec("ALTER TABLE plan_posts ADD COLUMN message_ids TEXT");
    // Backfill: set message_ids = json_array(message_id) for existing rows
    db.exec("UPDATE plan_posts SET message_ids = json_array(message_id) WHERE message_ids IS NULL");
    console.log("[db] migrated: added message_ids to plan_posts");
  }

  // Migrate: add message_thread_id column to channels + change UNIQUE(chat_id) → UNIQUE(chat_id, message_thread_id)
  const chColsNow = db.query("PRAGMA table_info(channels)").all() as { name: string }[];
  if (chColsNow.length > 0 && !chColsNow.some((c) => c.name === "message_thread_id")) {
    db.exec(`
      CREATE TABLE channels_new (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id           TEXT NOT NULL,
        title             TEXT NOT NULL DEFAULT '',
        username          TEXT,
        auto_approve      INTEGER NOT NULL DEFAULT 0,
        message_thread_id INTEGER,
        added_at          TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(chat_id, message_thread_id)
      )
    `);
    db.exec(`
      INSERT INTO channels_new (id, chat_id, title, username, auto_approve, message_thread_id, added_at)
      SELECT id, chat_id, title, username, auto_approve, NULL, added_at FROM channels
    `);
    db.exec("DROP TABLE channels");
    db.exec("ALTER TABLE channels_new RENAME TO channels");
    console.log("[db] migrated: added message_thread_id to channels, updated UNIQUE constraint");
  }

  // Migrate: add interval_minutes and interval_end columns to broadcast_groups
  const bgColsNow = db.query("PRAGMA table_info(broadcast_groups)").all() as { name: string }[];
  if (bgColsNow.length > 0 && !bgColsNow.some((c) => c.name === "interval_minutes")) {
    db.exec("ALTER TABLE broadcast_groups ADD COLUMN interval_minutes INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE broadcast_groups ADD COLUMN interval_end TEXT");
    console.log("[db] migrated: added interval_minutes and interval_end to broadcast_groups");
  }

  // Migrate: add interval columns to plan_posts
  const ppColsNow = db.query("PRAGMA table_info(plan_posts)").all() as { name: string }[];
  if (ppColsNow.length > 0 && !ppColsNow.some((c) => c.name === "interval_minutes")) {
    db.exec("ALTER TABLE plan_posts ADD COLUMN interval_minutes INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE plan_posts ADD COLUMN interval_end_time TEXT");
    db.exec("ALTER TABLE plan_posts ADD COLUMN interval_sent_count INTEGER NOT NULL DEFAULT 0");
    console.log("[db] migrated: added interval_minutes, interval_end_time, interval_sent_count to plan_posts");
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

export function getChannelByChatIdAndTopic(chatId: string, messageThreadId: number | null): Channel | null {
  if (messageThreadId != null) {
    return db.query("SELECT * FROM channels WHERE chat_id = ? AND message_thread_id = ?").get(chatId, messageThreadId) as Channel | null;
  }
  return db.query("SELECT * FROM channels WHERE chat_id = ? AND message_thread_id IS NULL").get(chatId) as Channel | null;
}

export function addChannel(chatId: string, title: string, username: string | null, messageThreadId: number | null = null): Channel {
  db.query("INSERT INTO channels (chat_id, title, username, message_thread_id) VALUES (?, ?, ?, ?)").run(chatId, title, username, messageThreadId);
  return getChannelByChatIdAndTopic(chatId, messageThreadId)!;
}

export function removeChannel(id: number) {
  db.query("DELETE FROM channels WHERE id = ?").run(id);
}

export function updateChannel(id: number, f: Partial<Pick<Channel, "auto_approve" | "message_thread_id">>) {
  const s: string[] = [];
  const v: (string | number | null)[] = [];
  if (f.auto_approve !== undefined) { s.push("auto_approve = ?"); v.push(f.auto_approve); }
  if (f.message_thread_id !== undefined) { s.push("message_thread_id = ?"); v.push(f.message_thread_id); }
  if (s.length === 0) return;
  v.push(id);
  db.query(`UPDATE channels SET ${s.join(", ")} WHERE id = ?`).run(...v);
}

export function getAutoApproveChannels(): Channel[] {
  return db.query("SELECT * FROM channels WHERE auto_approve = 1").all() as Channel[];
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
  f: Partial<Pick<Campaign, "name" | "schedule_type" | "schedule_value" | "default_time" | "jitter" | "is_active">>,
) {
  const s: string[] = [];
  const v: (string | number)[] = [];
  if (f.name !== undefined) { s.push("name = ?"); v.push(f.name); }
  if (f.schedule_type !== undefined) { s.push("schedule_type = ?"); v.push(f.schedule_type); }
  if (f.schedule_value !== undefined) { s.push("schedule_value = ?"); v.push(f.schedule_value); }
  if (f.default_time !== undefined) { s.push("default_time = ?"); v.push(f.default_time); }
  if (f.jitter !== undefined) { s.push("jitter = ?"); v.push(f.jitter); }
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
  f: Partial<Pick<BroadcastGroup, "send_time" | "schedule_type" | "schedule_value" | "total_days" | "days_sent" | "label" | "position" | "last_post_id" | "interval_minutes" | "interval_end">>,
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
  if (f.interval_minutes !== undefined) { s.push("interval_minutes = ?"); v.push(f.interval_minutes); }
  if (f.interval_end !== undefined) { s.push("interval_end = ?"); v.push(f.interval_end); }
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

export function addBroadcastGroupPost(groupId: number, chatId: string, messageIds: number[], label: string): BroadcastGroupPost {
  const firstMsgId = messageIds[0] ?? 0;
  const idsJson = JSON.stringify(messageIds);
  const r = db.query(
    "INSERT INTO broadcast_group_posts (group_id, chat_id, message_id, message_ids, label) VALUES (?,?,?,?,?)",
  ).run(groupId, chatId, firstMsgId, idsJson, label);
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

/** Check if a broadcast group was already sent at a specific time slot (HH:MM) today */
export function wasBroadcastGroupSentAtTime(groupId: number, timeSlot: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  // Check if there's a log entry within the same minute (sent_at contains full datetime)
  const start = `${today} ${timeSlot}:00`;
  const end = `${today} ${timeSlot}:59`;
  const row = db.query(
    "SELECT 1 FROM broadcast_send_log WHERE group_id = ? AND sent_at >= ? AND sent_at <= ? LIMIT 1",
  ).get(groupId, start, end) as { 1: number } | null;
  return row !== null;
}

/** All due broadcast groups across all active campaigns for current time */
export function getDueBroadcastGroups(currentTime: string, weekday: number): (BroadcastGroup & { channel_targets: ChannelTarget[] })[] {
  const today = new Date().toISOString().slice(0, 10);

  // Fetch all active groups with campaign jitter
  const rows = db.query(`
    SELECT bg.*, cmp.jitter AS cmp_jitter
    FROM broadcast_groups bg
    JOIN campaigns cmp ON cmp.id = bg.campaign_id
    WHERE cmp.is_active = 1
      AND bg.days_sent < bg.total_days
    ORDER BY bg.campaign_id, bg.position
  `).all() as (BroadcastGroup & { cmp_jitter: number })[];

  // Filter by schedule (applying deterministic jitter)
  const due = rows.filter((bg) => {
    // Interval mode: check if current time matches any interval slot
    if (bg.interval_minutes > 0) {
      return isDueForInterval(bg, currentTime, weekday, today);
    }

    // Non-interval mode (existing logic)
    let scheduledTime: string | null;
    if (bg.schedule_type === "detailed" && bg.schedule_value) {
      scheduledTime = getScheduleTimeForDay(bg.schedule_value, weekday);
    } else {
      scheduledTime = bg.send_time;
    }
    if (!scheduledTime) return false;

    const offset = getJitterOffset(bg.id, today, bg.cmp_jitter || 0);
    const jitteredTime = addMinutesToTime(scheduledTime, offset);
    return jitteredTime === currentTime;
  });

  return due.map((bg) => {
    const channels = getCampaignChannels(bg.campaign_id);
    return { ...bg, channel_targets: channels.map(toTarget) };
  });
}

/** Check if a broadcast group with interval is due at the current time */
function isDueForInterval(bg: BroadcastGroup & { cmp_jitter?: number }, currentTime: string, weekday: number, today: string): boolean {
  let startTime: string | null;
  let endTime: string | null;

  if (bg.schedule_type === "detailed" && bg.schedule_value) {
    // Detailed mode: get start/end from range schedule (56-char) or single schedule (28-char)
    const rangeResult = getScheduleRangeForDay(bg.schedule_value, weekday);
    if (rangeResult) {
      startTime = rangeResult.start;
      endTime = rangeResult.end;
    } else {
      // Fallback to single time
      startTime = getScheduleTimeForDay(bg.schedule_value, weekday);
      endTime = bg.interval_end;
    }
  } else {
    startTime = bg.send_time;
    endTime = bg.interval_end;
  }

  if (!startTime || !endTime) return false;

  // Apply jitter to start time
  const offset = getJitterOffset(bg.id, today, bg.cmp_jitter || 0);
  const jitteredStart = addMinutesToTime(startTime, offset);

  // Generate all interval times and check if current time matches any
  const intervalTimes = getIntervalTimes(jitteredStart, endTime, bg.interval_minutes);
  if (!intervalTimes.includes(currentTime)) return false;

  // Dedup: check if already sent at this specific time slot today
  if (wasBroadcastGroupSentAtTime(bg.id, currentTime)) return false;

  return true;
}

/** Get start/end times for a specific weekday from 56-char tgwidget range schedule */
export function getScheduleRangeForDay(scheduleValue: string, jsWeekday: number): { start: string; end: string } | null {
  if (scheduleValue.length !== 56) return null; // Not range format
  const idx = jsWeekday === 0 ? 6 : jsWeekday - 1;
  const offset = idx * 8;
  const block = scheduleValue.slice(offset, offset + 8);
  if (!block || block.length < 8 || block === "00000000") return null;
  const startH = block.slice(0, 2);
  const startM = block.slice(2, 4);
  const endH = block.slice(4, 6);
  const endM = block.slice(6, 8);
  return { start: `${startH}:${startM}`, end: `${endH}:${endM}` };
}

/** Generate all HH:MM times from start to end at the given interval (in minutes) */
export function getIntervalTimes(startTime: string, endTime: string, intervalMinutes: number): string[] {
  if (intervalMinutes <= 0) return [startTime];
  const [sh, sm] = startTime.split(":").map(Number) as [number, number];
  const [eh, em] = endTime.split(":").map(Number) as [number, number];
  let startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  if (endMins <= startMins) return [startTime];

  const times: string[] = [];
  while (startMins <= endMins) {
    const h = Math.floor(startMins / 60);
    const m = startMins % 60;
    times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    startMins += intervalMinutes;
  }
  return times;
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

export function addPlanPost(campaignId: number, chatId: string, messageIds: number[], label: string): PlanPost {
  const firstMsgId = messageIds[0] ?? 0;
  const idsJson = JSON.stringify(messageIds);
  const mx = db.query("SELECT COALESCE(MAX(position),-1) as m FROM plan_posts WHERE campaign_id = ?").get(campaignId) as { m: number };
  const r = db.query(
    "INSERT INTO plan_posts (campaign_id, chat_id, message_id, message_ids, label, position) VALUES (?,?,?,?,?,?)",
  ).run(campaignId, chatId, firstMsgId, idsJson, label, mx.m + 1);
  return getPlanPost(Number(r.lastInsertRowid))!;
}

export function updatePlanPost(
  id: number,
  f: Partial<Pick<PlanPost, "send_date" | "send_time" | "is_auto_time" | "is_sent" | "label" | "position" | "interval_minutes" | "interval_end_time" | "interval_sent_count">>,
) {
  const s: string[] = [];
  const v: (string | number | null)[] = [];
  if (f.send_date !== undefined) { s.push("send_date = ?"); v.push(f.send_date); }
  if (f.send_time !== undefined) { s.push("send_time = ?"); v.push(f.send_time); }
  if (f.is_auto_time !== undefined) { s.push("is_auto_time = ?"); v.push(f.is_auto_time); }
  if (f.is_sent !== undefined) { s.push("is_sent = ?"); v.push(f.is_sent); }
  if (f.label !== undefined) { s.push("label = ?"); v.push(f.label); }
  if (f.position !== undefined) { s.push("position = ?"); v.push(f.position); }
  if (f.interval_minutes !== undefined) { s.push("interval_minutes = ?"); v.push(f.interval_minutes); }
  if (f.interval_end_time !== undefined) { s.push("interval_end_time = ?"); v.push(f.interval_end_time); }
  if (f.interval_sent_count !== undefined) { s.push("interval_sent_count = ?"); v.push(f.interval_sent_count); }
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

/** Increment interval_sent_count for a plan post */
export function incrementPlanPostIntervalSent(id: number) {
  db.query("UPDATE plan_posts SET interval_sent_count = interval_sent_count + 1 WHERE id = ?").run(id);
}

/** All due plan posts across all active campaigns */
export function getAllDuePlanPosts(): (PlanPost & { channel_targets: ChannelTarget[] })[] {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const rows = db.query(`
    SELECT pp.*, cmp.jitter AS cmp_jitter
    FROM plan_posts pp
    JOIN campaigns cmp ON cmp.id = pp.campaign_id
    WHERE pp.is_sent = 0
      AND cmp.is_active = 1
      AND pp.send_date IS NOT NULL
      AND pp.send_time IS NOT NULL
    ORDER BY pp.send_date, pp.send_time
  `).all() as (PlanPost & { cmp_jitter: number })[];

  // Filter: apply deterministic jitter and handle interval logic
  const due = rows.filter((pp) => {
    if (!pp.send_date || !pp.send_time) return false;
    const offset = getJitterOffset(pp.id, pp.send_date, pp.cmp_jitter || 0);
    const jitteredTime = addMinutesToTime(pp.send_time, offset);

    // Interval mode: check if current time matches an interval slot
    if (pp.interval_minutes > 0 && pp.interval_end_time) {
      if (pp.send_date < date) return true;
      if (pp.send_date > date) return false;
      // Today: check if current time is in an interval slot
      const intervalTimes = getIntervalTimes(jitteredTime, pp.interval_end_time, pp.interval_minutes);
      return intervalTimes.includes(time);
    }

    // Non-interval mode (existing logic)
    // Due if date is in the past, or today and jittered time has arrived
    if (pp.send_date < date) return true;
    if (pp.send_date === date && jitteredTime <= time) return true;
    return false;
  });

  return due.map((pp) => {
    const channels = getCampaignChannels(pp.campaign_id);
    return { ...pp, channel_targets: channels.map(toTarget) };
  });
}

/** All active campaigns with their channel targets (for scheduler) */
export function getActiveCampaigns(): (Campaign & { channel_targets: ChannelTarget[] })[] {
  const campaigns = db.query("SELECT * FROM campaigns WHERE is_active = 1").all() as Campaign[];
  return campaigns.map((c) => ({
    ...c,
    channel_targets: getCampaignChannels(c.id).map(toTarget),
  }));
}

/** Check if a plan post's interval sends are all complete */
export function isPlanPostIntervalComplete(pp: PlanPost): boolean {
  if (pp.interval_minutes <= 0 || !pp.interval_end_time || !pp.send_time) return false;
  const intervalTimes = getIntervalTimes(pp.send_time, pp.interval_end_time, pp.interval_minutes);
  return pp.interval_sent_count >= intervalTimes.length;
}

/** Parse message_ids from JSON string, falling back to legacy message_id field */
export function parseMessageIds(post: { message_ids?: string | null; message_id: number }): number[] {
  if (post.message_ids) {
    try {
      const parsed = JSON.parse(post.message_ids);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "number") {
        return parsed as number[];
      }
    } catch { /* fall through */ }
  }
  return [post.message_id];
}

/* ═══════════════ Helpers ═════════════════════════════════════ */

function toTarget(ch: Channel): ChannelTarget {
  return { chat_id: ch.chat_id, message_thread_id: ch.message_thread_id };
}

export { db };
