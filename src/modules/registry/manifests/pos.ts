import type { ModuleManifest } from '../types';

// POS does not own a CRUD data_bucket; its permissions live under the
// `pos.<action>` namespace (see POS_ACTIONS in ../types). data_buckets/verbs
// are left empty so the matrix-row derivation in products.ts ignores it.
export const posManifest: ModuleManifest = {
  key: 'pos',
  label: 'POS',
  data_buckets: [],
  verbs: [],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/pos/menu', label: 'POS', viewKeys: ['pos.menu.view', 'pos.history.view'], order: 20 },
    { path: '/pos/sales', label: 'Sales', viewKeys: ['pos.history.view'], order: 80 },
    { path: '/pos/coupons', label: 'Coupons', viewKeys: ['pos.sale.refund'], order: 85 },
    { path: '/pos/reviews', label: 'Reviews', viewKeys: ['pos.history.viewAll'], order: 86 },
    { path: '/pos/bundles', label: 'Bundles', viewKeys: ['pos.sale.refund'], order: 87 },
    { path: '/pos/tax', label: 'Tax', viewKeys: ['pos.sale.refund'], order: 88 },
    { path: '/pos/storefront', label: 'Storefront', viewKeys: ['pos.sale.refund'], order: 89 },
    { path: '/pos/marketplace', label: 'Marketplace', viewKeys: ['pos.sale.refund'], order: 90 },
  ],
};
