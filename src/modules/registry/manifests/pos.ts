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
    // Ecommerce (ERP module 12): one sidebar link → /pos/coupons, the six surfaces
    // (Coupons/Reviews/Bundles/Tax/Storefront/Marketplace) render as in-page tabs
    // (EcommerceNav). viewKeys is the union so the link shows if the user can see any.
    { path: '/pos/coupons', label: 'Ecommerce', viewKeys: ['pos.sale.refund', 'pos.history.viewAll'], order: 85 },
  ],
};
