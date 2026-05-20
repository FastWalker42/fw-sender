import type { BotContext } from "../types";
import { isAdmin } from "../utils/admin";
import { e, E } from "../utils/emoji";
import { showMainMenu } from "../menus/main-menu";
import { getAwaiting } from "./callbacks";
import { handleMessage } from "./messages";

const TGWIDGET_STATES = new Set(["bp_enter_time", "pp_enter_time"]);

export async function handleStart(ctx: BotContext) {
  if (!isAdmin(ctx)) {
    await ctx.reply(`${e("🚫", E.STOPPED)} Этот бот только для администраторов.`, { parse_mode: "HTML" });
    return;
  }

  // If user is in an awaiting state that expects tgwidget data and /start has a payload,
  // delegate to handleMessage so the time parser can process it
  if (ctx.match && ctx.from) {
    const state = getAwaiting(ctx.from.id);
    if (state && TGWIDGET_STATES.has(state.action)) {
      return handleMessage(ctx);
    }
  }

  await showMainMenu(ctx);
}
