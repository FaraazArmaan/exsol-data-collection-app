import type { ModuleManifest } from '../types';

export const crmManifest: ModuleManifest = {
  key: 'crm',
  label: 'CRM',
  data_buckets: ['customers'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/crm', label: 'CRM', viewKeys: ['crm.customers.view'], order: 60 },
  ],
};
