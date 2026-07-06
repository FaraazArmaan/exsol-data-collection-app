import type { ModuleManifest } from '../types';

// Analytics is a read-only cross-module projection. It declares all four data
// buckets so each `analytics.<bucket>.view` key validates + renders in the
// access-level UI, but only the `view` verb — create/edit/delete are
// meaningless for a read projection.
export const analyticsManifest: ModuleManifest = {
  key: 'analytics',
  label: 'Analytics',
  data_buckets: ['business', 'customers', 'employees', 'products'],
  verbs: ['view'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/analytics', label: 'Analytics', viewKeys: ['analytics.business.view', 'analytics.customers.view', 'analytics.employees.view', 'analytics.products.view'], order: 90 },
  ],
};
