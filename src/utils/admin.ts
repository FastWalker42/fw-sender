import { ADMIN_IDS } from "../config";
import type { BotContext } from "../types";

export function isAdmin(ctx: BotContext): boolean {
  return ADMIN_IDS.includes(ctx.from?.id ?? 0);
}

export async function adminOnly(ctx: BotContext, next: () => Promise<void>) {
  if (!isAdmin(ctx)) return;
  await next();
}
