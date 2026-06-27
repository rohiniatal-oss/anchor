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
