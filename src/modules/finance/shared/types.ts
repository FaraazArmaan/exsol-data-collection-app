// Shared Finance types — mirror the wire shapes returned by the finance-*
// Netlify functions. Money is integer cents everywhere (never a float), matching
// sales.total_cents / bookings.price_cents across the platform.

// Keep in lockstep with FINANCE_CATEGORIES in netlify/functions/_finance-validators.ts
// and the CHECK constraint in migration 054.
export const FINANCE_CATEGORIES = [
  'rent', 'utilities', 'supplies', 'salaries',
  'marketing', 'equipment', 'maintenance', 'other',
] as const;
export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<FinanceCategory, string> = {
  rent: 'Rent',
  utilities: 'Utilities',
  supplies: 'Supplies',
  salaries: 'Salaries',
  marketing: 'Marketing',
  equipment: 'Equipment',
  maintenance: 'Maintenance',
  other: 'Other',
};

export interface Expense {
  id: string;
  client_id: string;
  category: FinanceCategory;
  amount_cents: number;
  note: string | null;
  incurred_on: string; // 'YYYY-MM-DD'
  created_by: string | null;
  created_at: string;
}

export interface ExpenseInput {
  category: FinanceCategory;
  amount_cents: number;
  incurred_on: string; // 'YYYY-MM-DD'
  note: string | null;
}

export interface RevenueByChannel {
  pos: number;
  storefront: number;
  booking: number;
}

export interface FinanceSummary {
  month: string; // 'YYYY-MM'
  revenue_cents: number;
  expenses_cents: number;
  net_cents: number;
  revenue_by_channel: RevenueByChannel;
}
