import type { ModuleManifest } from '../types';

// Manufacturing — vendor-side BOM + production over the product catalog. The
// 'products' bucket covers BOMs/orders/QC/parts/costs (product-stock scope); depth
// added the 'business' bucket for shop-floor ops that aren't product stock —
// maintenance/downtime logs and capacity planning. Keys are
// manufacturing.{products,business}.{view,create,edit,delete}. Toggle per client
// via the `manufacturing` Product.
export const manufacturingManifest: ModuleManifest = {
  key: 'manufacturing',
  label: 'Manufacturing',
  data_buckets: ['products', 'business'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/manufacturing', label: 'Manufacturing', viewKeys: ['manufacturing.products.view', 'manufacturing.business.view'], order: 50 },
  ],
};
