/**
 * Deterministic jitter offset for a given entity + date.
 * Returns the same value for the same (id, date, maxJitter) triple,
 * so restarts within the same day don't change the chosen offset.
 */
export function getJitterOffset(entityId: number, dateStr: string, maxJitter: number): number {
  if (maxJitter <= 0) return 0;
  const seed = `${entityId}-${dateStr}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const range = 2 * maxJitter + 1; // e.g. jitter=2 → range=5 → offsets: -2,-1,0,+1,+2
  return ((hash % range) + range) % range - maxJitter;
}

/**
 * Add minutes to an "HH:MM" string. Handles day overflow/underflow
 * by clamping to 00:00–23:59.
 */
export function addMinutesToTime(time: string, minutes: number): string {
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  let total = hh * 60 + mm + minutes;
  if (total < 0) total = 0;
  if (total > 1439) total = 1439; // 23:59
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
