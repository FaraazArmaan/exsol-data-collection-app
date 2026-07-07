import type { ModuleManifest } from '../types';

export const marketingManifest: ModuleManifest = {
  key: 'marketing',
  label: 'Marketing',
  // DATA_BUCKETS is a closed platform union (products|business|employees|
  // customers) — a module CANNOT mint its own bucket. Every marketing surface,
  // depth included, maps to `customers` × {view,create,edit,delete}. ROI is a
  // read projection ⇒ customers.view; GDPR erase ⇒ customers.delete.
  data_buckets: ['customers'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/marketing', label: 'Marketing', viewKeys: ['marketing.customers.view'], order: 70 },
    { path: '/marketing/roi', label: 'Campaign ROI', viewKeys: ['marketing.customers.view'], order: 71 },
    { path: '/marketing/webhooks', label: 'Webhooks', viewKeys: ['marketing.customers.view'], order: 72 },
    { path: '/marketing/gdpr', label: 'GDPR', viewKeys: ['marketing.customers.view'], order: 73 },
    { path: '/marketing/social', label: 'Social', viewKeys: ['marketing.customers.view'], order: 74 },
  ],
};
