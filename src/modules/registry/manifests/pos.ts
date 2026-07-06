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
    { path: '/pos/sales', label: 'Orders', viewKeys: ['pos.history.view'], order: 80 },
  ],
};
