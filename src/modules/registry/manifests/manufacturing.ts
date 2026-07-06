import type { ModuleManifest } from '../types';

// Manufacturing — vendor-side BOM + production over the product catalog. Uses
// the 'products' data bucket, so keys are manufacturing.products.{view,create,
// edit,delete}. Toggle per client via the `manufacturing` Product.
export const manufacturingManifest: ModuleManifest = {
  key: 'manufacturing',
  label: 'Manufacturing',
  data_buckets: ['products'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/manufacturing', label: 'Manufacturing', viewKeys: ['manufacturing.products.view'], order: 50 },
  ],
};
