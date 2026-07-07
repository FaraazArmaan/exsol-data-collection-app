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

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Expense {
  id: string;
  client_id: string;
  category: FinanceCategory;
  amount_cents: number; // minor units of `currency`
  currency: string; // entry currency (ISO code)
  amount_base_cents: number; // value in the client base currency
  fx_rate: number; // base major units per 1 entry major unit
  note: string | null;
  incurred_on: string; // 'YYYY-MM-DD'
  created_by: string | null;
  created_at: string;
  template_id: string | null; // set when auto-materialized from a recurring template
  approval_status: ApprovalStatus | null; // null = below threshold / not gated
  approved_by: string | null;
  approved_at: string | null;
  approval_note: string | null;
}

export interface FinanceSettings {
  approval_threshold_cents: number; // base-currency minor units; 0 = approvals off
  base_currency: string;
}

// --- OCR receipt capture -------------------------------------------------
export interface ReceiptPrefill {
  category: FinanceCategory | null;
  amount: number | null; // major units in `currency`
  currency: string | null;
  incurred_on: string | null; // 'YYYY-MM-DD'
  note: string | null;
}

export interface ExpenseInput {
  category: FinanceCategory;
  amount_cents: number;
  incurred_on: string; // 'YYYY-MM-DD'
  note: string | null;
  currency?: string; // omitted ⇒ client base currency
  fx_rate?: number; // required by the server when currency ≠ base
}

export interface RevenueByChannel {
  pos: number;
  storefront: number;
  booking: number;
}

export interface FinanceSummary {
  month: string; // 'YYYY-MM'
  base_currency: string;
  revenue_cents: number;
  expenses_cents: number;
  net_cents: number;
  revenue_by_channel: RevenueByChannel;
}

// --- Cashflow calendar ---------------------------------------------------
export interface CashflowDay {
  date: string; // 'YYYY-MM-DD'
  income_cents: number;
  expense_cents: number;
  net_cents: number;
}

export interface CashflowMonth {
  month: string; // 'YYYY-MM'
  base_currency: string;
  days: CashflowDay[]; // sparse — only days with activity
  totals: { income_cents: number; expense_cents: number; net_cents: number };
}

// --- Recurring / milestone templates -------------------------------------
export const CADENCES = ['once', 'weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_LABELS: Record<Cadence, string> = {
  once: 'One-time (milestone)',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export interface RecurringTemplate {
  id: string;
  client_id: string;
  category: FinanceCategory;
  amount_cents: number;
  currency: string;
  fx_rate: number;
  note: string | null;
  cadence: Cadence;
  next_run: string; // 'YYYY-MM-DD'
  active: boolean;
  last_materialized_on: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RecurringInput {
  category: FinanceCategory;
  amount_cents: number;
  cadence: Cadence;
  next_run: string;
  note: string | null;
  currency?: string;
  fx_rate?: number;
}

// --- AI insights ---------------------------------------------------------
export type InsightSeverity = 'info' | 'warn' | 'high';

export interface InsightAnomaly {
  title: string;
  severity: InsightSeverity;
  detail: string;
}

export interface AiInsight {
  month: string;
  base_currency: string;
  narrative: string;
  anomalies: InsightAnomaly[];
  health_score: number; // 0-100
  facts: {
    revenue_cents: number;
    expenses_cents: number;
    net_cents: number;
    prev_net_cents: number;
    revenue_by_channel: RevenueByChannel;
    expenses_by_category: Array<{ category: string; cents: number }>;
  };
  model: string;
  is_fallback: boolean; // rule-based (no LLM key) vs live model output
  generated_at: string;
  cached: boolean;
}
