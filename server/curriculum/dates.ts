// Date helpers for curriculum materialisation. Import-free so both the repository
// (creation-time planned dates) and the materializer (skip-driven shifts) can use
// them without an import cycle. All dates are YYYY-MM-DD (UTC, calendar-day math).

export function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayYmd(): string {
  return toYmd(new Date());
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const base = Date.UTC(y, (m || 1) - 1, d || 1);
  return toYmd(new Date(base + days * 86_400_000));
}

export function daysBetween(fromYmd: string, toYmdValue: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  return Math.round((parse(toYmdValue) - parse(fromYmd)) / 86_400_000);
}

function weekdayUtc(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

function isWeekend(ymd: string): boolean {
  const dow = weekdayUtc(ymd);
  return dow === 0 || dow === 6;
}

/**
 * Starting from `ymd`, advance `offset` weekdays forward (Mon–Fri), skipping
 * Sat/Sun. offset=0 returns `ymd` itself if it is a weekday, or the next Monday
 * if `ymd` falls on a weekend. Pure, UTC, side-effect-free.
 */
export function nextWeekday(ymd: string, offset: number): string {
  let cur = ymd;
  while (isWeekend(cur)) cur = addDays(cur, 1);
  let remaining = Math.max(0, Math.floor(offset));
  while (remaining > 0) {
    cur = addDays(cur, 1);
    if (!isWeekend(cur)) remaining -= 1;
  }
  return cur;
}

/**
 * Treat `ymd` as day N and return day N+days, counting only weekdays. Forward for
 * positive `days`, backward for negative. Pure, UTC, side-effect-free.
 */
export function shiftWeekday(ymd: string, days: number): string {
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(Math.floor(days));
  let cur = ymd;
  while (remaining > 0) {
    cur = addDays(cur, step);
    if (!isWeekend(cur)) remaining -= 1;
  }
  return cur;
}
