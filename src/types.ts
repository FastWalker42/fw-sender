import type { Context, SessionFlavor } from "grammy";
import type { ConversationFlavor } from "@grammyjs/conversations";

export interface Channel {
  id: number;
  chat_id: string;
  title: string;
  username: string | null;
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
  is_active: number;
  created_at: string;
}

export interface CampaignChannel {
  id: number;
  campaign_id: number;
  channel_id: number;
}

/** Auto-broadcast post (randomly selected, no repeats) */
export interface BroadcastPost {
  id: number;
  campaign_id: number;
  chat_id: string;
  message_id: number;
  label: string;
  position: number;
  created_at: string;
}

export interface BroadcastSendLog {
  id: number;
  campaign_id: number;
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
}

export type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor<Context>;
