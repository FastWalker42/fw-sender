import { parseSchedule } from "tgwidget";
import type { BroadcastGroup } from "../types";

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Format group schedule for display in UI */
export function formatGroupSchedule(group: BroadcastGroup): string {
  // Interval mode
  if (group.interval_minutes > 0) {
    return formatIntervalSchedule(group);
  }

  if (group.schedule_type === "detailed" && group.schedule_value) {
    try {
      const days = parseSchedule(group.schedule_value, { format: group.schedule_value.length === 56 ? "range" : "single" });
      const parts: string[] = [];
      for (let i = 0; i < days.length && i < 7; i++) {
        const day = days[i]!;
        if (day.enabled) {
          if (day.start && day.end) {
            parts.push(`${DAY_NAMES[i]} ${day.start}–${day.end}`);
          } else if (day.time) {
            parts.push(`${DAY_NAMES[i]} ${day.time}`);
          }
        }
      }
      if (parts.length === 0) return "Расписание: все дни выключены";
      return `Расписание: ${parts.join(", ")}`;
    } catch {
      return `Расписание: (ошибка)`;
    }
  }
  return `Время: ${group.send_time} (ежедневно)`;
}

/** Format interval schedule info for broadcast groups */
export function formatIntervalSchedule(group: BroadcastGroup): string {
  if (group.schedule_type === "detailed" && group.schedule_value) {
    // Detailed + interval: per-weekday windows with interval
    try {
      const days = parseSchedule(group.schedule_value, { format: group.schedule_value.length === 56 ? "range" : "single" });
      const parts: string[] = [];
      for (let i = 0; i < days.length && i < 7; i++) {
        const day = days[i]!;
        if (day.enabled) {
          if (day.start && day.end) {
            parts.push(`${DAY_NAMES[i]} ${day.start}–${day.end}`);
          } else if (day.time) {
            const end = group.interval_end || "?";
            parts.push(`${DAY_NAMES[i]} ${day.time}–${end}`);
          }
        }
      }
      if (parts.length === 0) return "Интервал: все дни выключены";
      return `Интервал: каждые ${group.interval_minutes} мин., ${parts.join(", ")}`;
    } catch {
      return `Интервал: каждые ${group.interval_minutes} мин. (ошибка расписания)`;
    }
  }

  // Simple + interval
  const end = group.interval_end || "?";
  return `Интервал: ${group.send_time}–${end}, каждые ${group.interval_minutes} мин.`;
}

/** Format interval info for plan posts */
export function formatPlanPostInterval(intervalMinutes: number, intervalEndTime: string | null, intervalSentCount: number): string {
  if (intervalMinutes <= 0) return "";
  const end = intervalEndTime || "?";
  const sent = intervalSentCount > 0 ? ` (отправлено ${intervalSentCount} раз)` : "";
  return `Интервал: каждые ${intervalMinutes} мин. до ${end}${sent}`;
}
