export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

// Chart theme (kept local to the module; the only recharts-adjacent constants).
export const CHART_FILL = '#6366f1';
export const AXIS_STROKE = '#64748b';
export const GRID_STROKE = '#e2e8f0';
