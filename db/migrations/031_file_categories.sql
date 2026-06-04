-- Migration 031: file_categories — join table for file → category labels.
-- See docs/superpowers/specs/2026-06-04-file-manager-design.md §4.2.
-- The CHECK constraint must stay in lockstep with
-- src/modules/files/shared/categories.ts (CATEGORY_KEYS).

CREATE TABLE public.file_categories (
  file_id      uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  category_key text NOT NULL,
  PRIMARY KEY (file_id, category_key),
  CONSTRAINT file_categories_known_key CHECK (category_key IN (
    'finance_accounting', 'hr_payroll', 'legal_compliance', 'sales_crm',
    'marketing_brand', 'product_catalog', 'procurement_supply_chain',
    'operations_warehouse', 'manufacturing', 'customer_service', 'project_workflow'
  ))
);

CREATE INDEX file_categories_category_idx ON public.file_categories (category_key);
