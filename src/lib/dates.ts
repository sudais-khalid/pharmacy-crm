export const TZ = process.env.APP_TIMEZONE || "Asia/Karachi";

/** Today's calendar date (YYYY-MM-DD) in the configured timezone. */
export function todayStr(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** Add days to a YYYY-MM-DD string. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Convert YYYY-MM-DD to a Date at UTC midnight (for @db.Date columns). */
export function dateOnly(s: string): Date {
  return new Date(s + "T00:00:00.000Z");
}
