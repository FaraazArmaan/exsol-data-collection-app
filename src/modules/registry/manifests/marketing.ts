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
  // Single sidebar link; the depth surfaces (Campaign ROI / Webhooks / GDPR /
  // Social) are in-page tabs (MarketingNav), not separate sidebar entries.
  navLinks: [
    { path: '/marketing', label: 'Marketing', viewKeys: ['marketing.customers.view'], order: 70 },
  ],
};
