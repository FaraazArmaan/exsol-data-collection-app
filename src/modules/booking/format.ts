// Display helpers for the booking UI. Times render in the browser's local zone
// (customers are normally in the tenant's region); backend returns UTC ISO.

export function formatRupees(cents: number): string {
  return `₹${(cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function paymentChip(mode: string, depositCents: number | null): string | null {
  if (mode === 'pay_at_venue') return null;
  if (mode === 'deposit') return depositCents ? `${formatRupees(depositCents)} deposit` : 'Deposit';
  return 'Pay online';
}

/** YYYY-MM-DD for `n` days from today, in the browser's local zone. */
export function isoDatePlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
