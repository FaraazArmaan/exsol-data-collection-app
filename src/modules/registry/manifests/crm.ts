import type { ModuleManifest } from '../types';

export const crmManifest: ModuleManifest = {
  key: 'crm',
  label: 'CRM',
  data_buckets: ['customers'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
};
