import type { CategoryKey } from './categories';

// Per-category accent dot colours (frontend-only; not part of the DB CHECK).
// Muted, theme-consistent hues — used as small swatches on chips, never as
// large fills, so they stay quiet against the warm-dark surfaces.
export const CATEGORY_COLORS: Record<CategoryKey, string> = {
  finance_accounting:        '#5a9e5b',
  hr_payroll:                '#9b7fce',
  legal_compliance:          '#c97064',
  sales_crm:                 '#d9b877',
  marketing_brand:           '#5fa8c9',
  product_catalog:           '#7c8cd9',
  procurement_supply_chain:  '#b58a5a',
  operations_warehouse:      '#7fa97f',
  manufacturing:             '#c98a8a',
  customer_service:          '#5fc9c0',
  project_workflow:          '#c9c07f',
};
