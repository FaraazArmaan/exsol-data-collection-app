import type { ModuleManifest } from '../types';

export const emailManifest: ModuleManifest = {
  key: 'email',
  label: 'Email & Notifications',
  data_buckets: ['customers'],
  verbs: ['view'],
  vendor_side: true,
  customer_side: false,
};
