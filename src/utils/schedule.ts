import { parseSchedule } from "tgwidget";
import type { BroadcastGroup } from "../types";

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Format group schedule for display in UI */
export function formatGroupSchedule(group: BroadcastGroup): string {
  if (group.schedule_type === "detailed" && group.schedule_value) {
    try {
      const days = parseSchedule(group.schedule_value, { format: "single" });
      const parts: string[] = [];
      for (let i = 0; i < days.length && i < 7; i++) {
        const day = days[i]!;
        if (day.enabled) {
          parts.push(`${DAY_NAMES[i]} ${day.time}`);
        }
      }
      if (parts.length === 0) return "Расписание: все дни выключены";
      // Check if all enabled days have the same time
      const times = parts.map((p) => p.split(" ")[1]);
      const uniqueTimes = [...new Set(times)];
      if (uniqueTimes.length === 1 && parts.length === 7) {
        return `Ежедневно в ${uniqueTimes[0]}`;
      }
      return `Расписание: ${parts.join(", ")}`;
    } catch {
      return `Расписание: (ошибка)`;
    }
  }
  return `Время: ${group.send_time} (ежедневно)`;
}
