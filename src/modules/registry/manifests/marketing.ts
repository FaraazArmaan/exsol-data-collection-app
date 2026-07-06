import type { ModuleManifest } from '../types';

export const marketingManifest: ModuleManifest = {
  key: 'marketing',
  label: 'Marketing',
  data_buckets: ['customers'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
};
