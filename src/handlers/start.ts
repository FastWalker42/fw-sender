import type { BotContext } from "../types";
import { isAdmin } from "../utils/admin";
import { e, E } from "../utils/emoji";
import { showMainMenu } from "../menus/main-menu";

export async function handleStart(ctx: BotContext) {
  if (!isAdmin(ctx)) {
    await ctx.reply(`${e("🚫", E.STOPPED)} Этот бот только для администраторов.`, { parse_mode: "HTML" });
    return;
  }

  await showMainMenu(ctx);
}
