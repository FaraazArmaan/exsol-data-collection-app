// Source of truth for File Manager category keys.
// Mirrored by the CHECK constraint in db/migrations/031_file_categories.sql —
// any change here requires a follow-up migration.

export const CATEGORY_KEYS = [
  'finance_accounting',
  'hr_payroll',
  'legal_compliance',
  'sales_crm',
  'marketing_brand',
  'product_catalog',
  'procurement_supply_chain',
  'operations_warehouse',
  'manufacturing',
  'customer_service',
  'project_workflow',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  finance_accounting: 'Finance & Accounting',
  hr_payroll: 'HR & Payroll',
  legal_compliance: 'Legal & Compliance',
  sales_crm: 'Sales & CRM',
  marketing_brand: 'Marketing & Brand',
  product_catalog: 'Product / Catalog',
  procurement_supply_chain: 'Procurement & Supply Chain',
  operations_warehouse: 'Operations & Warehouse',
  manufacturing: 'Manufacturing',
  customer_service: 'Customer Service',
  project_workflow: 'Project & Workflow',
};

export function isCategoryKey(s: string): s is CategoryKey {
  return (CATEGORY_KEYS as readonly string[]).includes(s);
}

export const MAX_CATEGORIES_PER_FILE = 3;
