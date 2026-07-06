// Display helpers for the CRM UI. Times render in the browser's local zone.
// Backend returns UTC ISO strings; dates return YYYY-MM-DD from the server.

export function money(cents: number): string {
  return `₹${(cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}
