import type { Context, SessionFlavor } from "grammy";
import type { ConversationFlavor } from "@grammyjs/conversations";

export interface Channel {
  id: number;
  chat_id: string;
  title: string;
  username: string | null;
  auto_approve: number;
  added_at: string;
}

export interface Campaign {
  id: number;
  name: string;
  /** Auto-broadcast schedule type */
  schedule_type: "simple" | "detailed";
  /** simple → "HH:MM"; detailed → tgwidget single-28 weekly schedule */
  schedule_value: string;
  /** Default time for plan posts when AUTO is pressed (HH:MM) */
  default_time: string;
  /** Random send-time offset in minutes (±jitter). 0 = exact time. */
  jitter: number;
  is_active: number;
  created_at: string;
}

export interface CampaignChannel {
  id: number;
  campaign_id: number;
  channel_id: number;
}

/** Group of posts for auto-broadcast (random selection from group) */
export interface BroadcastGroup {
  id: number;
  campaign_id: number;
  label: string;
  position: number;
  send_time: string;
  /** 'simple' = same time every day; 'detailed' = per-weekday tgwidget schedule */
  schedule_type: "simple" | "detailed";
  /** For detailed mode: 28-char tgwidget single schedule string */
  schedule_value: string;
  total_days: number;
  days_sent: number;
  last_post_id: number | null;
  created_at: string;
}

/** Individual post within a broadcast group */
export interface BroadcastGroupPost {
  id: number;
  group_id: number;
  chat_id: string;
  message_id: number;
  label: string;
  created_at: string;
}

export interface BroadcastSendLog {
  id: number;
  campaign_id: number;
  group_id: number;
  post_id: number;
  sent_at: string;
}

/** Planned post with specific date/time */
export interface PlanPost {
  id: number;
  campaign_id: number;
  chat_id: string;
  message_id: number;
  label: string;
  send_date: string | null;
  send_time: string | null;
  is_auto_time: number;
  is_sent: number;
  position: number;
  created_at: string;
}

export interface SessionData {
  step?: string;
  convPayload?: string;
}

export type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor<Context>;
