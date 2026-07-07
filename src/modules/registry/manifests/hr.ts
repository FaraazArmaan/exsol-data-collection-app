import type { ModuleManifest } from '../types';

// HR is a vendor-side people surface OVER the canonical user_nodes tree — org
// chart, headcount analytics, and onboarding/offboarding checklists. People stay
// canonical in user_nodes (identity carries authority); HR adds no duplicate
// person table. All surfaces are "employees" data → bucket×verb keys
// hr.employees.{view,create,edit,delete}.
export const hrManifest: ModuleManifest = {
  key: 'hr',
  label: 'Human Resources',
  data_buckets: ['employees'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/hr', label: 'HR', viewKeys: ['hr.employees.view'], order: 160 },
  ],
};
