// Shared formatting + chart theme for the Analytics UI. Money is stored and
// returned as integer cents; render as INR (the platform currency).

const inr0 = new Intl.NumberFormat(undefined, {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
});
const inr2 = new Intl.NumberFormat(undefined, {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const int = new Intl.NumberFormat();

export function formatValue(value: number, unit: 'cents' | 'count'): string {
  if (unit !== 'cents') return int.format(value);
  // Whole rupees for large sums; show paise when the amount is under ₹100 so
  // tiny test/real values (e.g. ₹1.50) don't collapse to a bare ₹1.
  const rupees = value / 100;
  return Math.abs(rupees) < 100 ? inr2.format(rupees) : inr0.format(rupees);
}

export function formatCents(value: number): string {
  return formatValue(value, 'cents');
}

// Warm categorical palette that reads on the near-black theme (avoids the
// default recharts blue/purple which clashes with the cream accent).
export const CHART_COLORS = [
  '#c9a26a', // amber
  '#7fa97f', // sage (matches --success)
  '#8a9bb0', // slate blue
  '#b08aae', // mauve
  '#c97064', // clay (matches --danger)
  '#9db06a', // olive
];

// Local-date helpers. `new Date().toISOString()` yields the UTC date, which for
// an Asia/Kolkata user after ~18:30 rolls to tomorrow; format from local
// components instead so the default "Today" matches the user's calendar day.
export function todayISO(): string {
  return localISO(new Date());
}
export function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localISO(d);
}

export const AXIS_TICK = { fill: '#6b6862', fontSize: 12 };
export const AXIS_STROKE = '#3a3a3a';
export const GRID_STROKE = '#2a2a2a';
export const LINE_COLOR = '#c9a26a';
