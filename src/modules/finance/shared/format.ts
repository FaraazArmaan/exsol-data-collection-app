// Money + month formatting for the Finance UI. Money is integer cents rendered
// as INR (the platform currency), matching analytics/format.ts.

const inr0 = new Intl.NumberFormat(undefined, {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
});
const inr2 = new Intl.NumberFormat(undefined, {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatCents(value: number): string {
  const rupees = value / 100;
  // Show paise under ₹100 so small values don't collapse to a bare ₹1.
  return Math.abs(rupees) < 100 ? inr2.format(rupees) : inr0.format(rupees);
}

// Local calendar month as 'YYYY-MM' (avoids the UTC roll that toISOString would
// cause for Asia/Kolkata users late in the day).
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 'YYYY-MM' → 'July 2026'
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// 'YYYY-MM-DD' (or a full ISO date) → '3 Jul 2026'
export function formatDay(iso: string): string {
  const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
