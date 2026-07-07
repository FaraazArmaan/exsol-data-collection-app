import { z } from 'zod';
import { isSupportedCurrency } from '../../src/lib/currency';

// The fixed expense taxonomy — mirrors the CHECK constraint in migration 054
// so the API rejects unknown categories before Postgres does, and the UI can
// render a stable dropdown.
export const FINANCE_CATEGORIES = [
  'rent', 'utilities', 'supplies', 'salaries',
  'marketing', 'equipment', 'maintenance', 'other',
] as const;
export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM');

// Validated against the shared currency registry (src/lib/currency) so it stays
// in sync as currencies are added. Optional — defaults to the client's base.
const currencyCode = z.string().refine(isSupportedCurrency, 'unsupported_currency');

// note: nullable + optional so the form can clear it. amount_cents is integer
// minor units of `currency` (never a float). fx_rate = base major units per 1
// entry major unit; required only when currency ≠ base (enforced in the handler).
export const ExpenseCreate = z.object({
  category: z.enum(FINANCE_CATEGORIES),
  amount_cents: z.number().int().nonnegative(),
  incurred_on: isoDay,
  note: z.string().max(500).nullish(),
  currency: currencyCode.optional(),
  fx_rate: z.number().positive().optional(),
});
export type ExpenseCreate = z.infer<typeof ExpenseCreate>;

// Every field optional for PATCH; at least the shape is validated.
export const ExpensePatch = ExpenseCreate.partial();
export type ExpensePatch = z.infer<typeof ExpensePatch>;

// The P&L + expenses list are always scoped to a single calendar month.
export const MonthQuery = z.object({ month: isoMonth });
export type MonthQuery = z.infer<typeof MonthQuery>;

// --- Recurring / milestone templates ------------------------------------
export const CADENCES = ['once', 'weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];

export const RecurringCreate = z.object({
  category: z.enum(FINANCE_CATEGORIES),
  amount_cents: z.number().int().nonnegative(),
  currency: currencyCode.optional(),
  fx_rate: z.number().positive().optional(),
  note: z.string().max(500).nullish(),
  cadence: z.enum(CADENCES),
  next_run: isoDay,
});
export type RecurringCreate = z.infer<typeof RecurringCreate>;

export const RecurringPatch = z.object({
  category: z.enum(FINANCE_CATEGORIES).optional(),
  amount_cents: z.number().int().nonnegative().optional(),
  currency: currencyCode.optional(),
  fx_rate: z.number().positive().optional(),
  note: z.string().max(500).nullish(),
  cadence: z.enum(CADENCES).optional(),
  next_run: isoDay.optional(),
  active: z.boolean().optional(),
});
export type RecurringPatch = z.infer<typeof RecurringPatch>;

// --- Approvals ------------------------------------------------------------
// Threshold is in the client base-currency minor units. 0 disables approvals.
export const SettingsUpdate = z.object({
  approval_threshold_cents: z.number().int().nonnegative(),
});
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

export const ApprovalDecision = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(500).nullish(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalQuery = z.object({
  status: z.enum(['pending', 'decided']).default('pending'),
});
export type ApprovalQuery = z.infer<typeof ApprovalQuery>;

// --- OCR receipt capture --------------------------------------------------
// image is raw base64 (no data-URI prefix). ~11MB cap on the base64 string.
export const OcrRequest = z.object({
  image_base64: z.string().min(1).max(15_000_000),
  media_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
});
export type OcrRequest = z.infer<typeof OcrRequest>;
