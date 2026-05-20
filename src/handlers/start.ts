import type { BotContext } from "../types";
import { isAdmin } from "../utils/admin";
import { showMainMenu } from "../menus/main-menu";
import { parseDate, parseSchedule } from "tgwidget";
import * as db from "../db";

export async function handleStart(ctx: BotContext) {
  if (!isAdmin(ctx)) {
    await ctx.reply("⛔ Этот бот только для администраторов.");
    return;
  }

  const payload = ctx.match as string | undefined;

  if (payload && payload.startsWith("tw_")) {
    await handleWidgetCallback(ctx, payload);
    return;
  }

  await showMainMenu(ctx);
}

async function handleWidgetCallback(ctx: BotContext, payload: string) {
  // tw_{type}_{id}_{value...}
  const idx1 = payload.indexOf("_", 3); // after "tw_"
  const idx2 = payload.indexOf("_", idx1 + 1);
  if (idx1 === -1 || idx2 === -1) {
    await ctx.reply("Некорректный формат данных виджета.");
    return;
  }

  const type = payload.slice(3, idx1);
  const id = parseInt(payload.slice(idx1 + 1, idx2), 10);
  const value = payload.slice(idx2 + 1);

  if (isNaN(id)) {
    await ctx.reply("Некорректный ID.");
    return;
  }

  try {
    switch (type) {
      case "ct": {
        // Campaign time (simple schedule)
        const parsed = parseDate(value, { mode: "time" });
        if (parsed) {
          db.updateCampaign(id, { schedule_type: "simple", schedule_value: parsed.time });
          await ctx.reply(`⏰ Расписание обновлено: ежедневно в ${parsed.time}`);
        }
        break;
      }
      case "cs": {
        // Campaign detailed schedule
        const parsed = parseSchedule(value, { format: "single" });
        if (parsed) {
          db.updateCampaign(id, { schedule_type: "detailed", schedule_value: value });
          await ctx.reply("📋 Подробное расписание обновлено.");
        }
        break;
      }
      case "cdt": {
        // Campaign default time
        const parsed = parseDate(value, { mode: "time" });
        if (parsed) {
          db.updateCampaign(id, { default_time: parsed.time });
          await ctx.reply(`🕐 Дефолт-время плана обновлено: ${parsed.time}`);
        }
        break;
      }
      case "pdt": {
        // Plan post datetime
        const parsed = parseDate(value, { mode: "datetime" });
        if (parsed) {
          db.updatePlanPost(id, { send_date: parsed.date!, send_time: parsed.time!, is_auto_time: 0 });
          await ctx.reply(`📅 Время отправки: ${parsed.date} ${parsed.time}`);
        }
        break;
      }
      default:
        await ctx.reply("Неизвестный тип виджета.");
    }
  } catch {
    await ctx.reply("⚠️ Ошибка обработки данных виджета.");
  }
}
