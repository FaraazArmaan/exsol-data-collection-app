import type { ModuleManifest } from '../types';

export const paymentsManifest: ModuleManifest = {
  key: 'payments',
  label: 'Payments',
  data_buckets: ['customers', 'products'],
  verbs: ['view', 'create', 'edit'],  // no 'delete' — payments are immutable once captured
  vendor_side: true,
  customer_side: true,
};
