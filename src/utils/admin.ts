import { ADMIN_IDS } from "../config";
import type { BotContext } from "../types";
import { e, E } from "./emoji";

export function isAdmin(ctx: BotContext): boolean {
  return ADMIN_IDS.includes(ctx.from?.id ?? 0);
}

export async function adminOnly(ctx: BotContext, next: () => Promise<void>) {
  if (!isAdmin(ctx)) {
    await ctx.reply(`${e("🚫", E.STOPPED)} Доступ запрещён.`, { parse_mode: "HTML" });
    return;
  }
  await next();
}
