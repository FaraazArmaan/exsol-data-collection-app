//
// Pure date-window + delta math for analytics endpoints. No DB access here so
// it stays unit-testable. The tz-aware day bucket lives in SQL (see endpoints):
//   date_trunc('day', created_at AT TIME ZONE $tz)

export type CompareMode = 'prior_period' | 'prior_year' | 'none';

// Parse a YYYY-MM-DD into a UTC-midnight Date (no tz drift for pure date math).
function parseDay(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
}
function fmtDay(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}
const MS_PER_DAY = 86_400_000;

export function compareWindow(
  from: string,
  to: string,
  mode: CompareMode,
): { from: string; to: string } | null {
  if (mode === 'none') return null;
  const f = parseDay(from);
  const t = parseDay(to);
  if (mode === 'prior_year') {
    const pf = new Date(Date.UTC(f.getUTCFullYear() - 1, f.getUTCMonth(), f.getUTCDate()));
    const pt = new Date(Date.UTC(t.getUTCFullYear() - 1, t.getUTCMonth(), t.getUTCDate()));
    return { from: fmtDay(pf), to: fmtDay(pt) };
  }
  // prior_period — equal-length window immediately before [from, to].
  const lenDays = Math.round((t.getTime() - f.getTime()) / MS_PER_DAY) + 1; // inclusive
  const pt = new Date(f.getTime() - MS_PER_DAY);
  const pf = new Date(pt.getTime() - (lenDays - 1) * MS_PER_DAY);
  return { from: fmtDay(pf), to: fmtDay(pt) };
}

export function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / prior) * 100;
}
