import type { ModuleManifest } from '../types';

// Orders is a vendor-side management surface over the POS sales pipeline.
// A single `business` bucket with full CRUD:
//   orders.business.{view,create,edit,delete}
// `requires: ['pos']` in the Product manifest ensures the underlying sales
// data exists before this module can be enabled.
export const ordersManifest: ModuleManifest = {
  key: 'orders',
  label: 'Order Management',
  data_buckets: ['business'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [{ path: '/orders', label: 'Orders', viewKeys: ['orders.business.view'], order: 55 }],
};
