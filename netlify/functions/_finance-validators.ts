import { z } from 'zod';

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

// note: nullable + optional so the form can clear it. amount_cents is integer
// cents (never a float) to stay inside the platform money convention.
export const ExpenseCreate = z.object({
  category: z.enum(FINANCE_CATEGORIES),
  amount_cents: z.number().int().nonnegative(),
  incurred_on: isoDay,
  note: z.string().max(500).nullish(),
});
export type ExpenseCreate = z.infer<typeof ExpenseCreate>;

// Every field optional for PATCH; at least the shape is validated.
export const ExpensePatch = ExpenseCreate.partial();
export type ExpensePatch = z.infer<typeof ExpensePatch>;

// The P&L + expenses list are always scoped to a single calendar month.
export const MonthQuery = z.object({ month: isoMonth });
export type MonthQuery = z.infer<typeof MonthQuery>;
