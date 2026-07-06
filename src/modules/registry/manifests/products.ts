import type { ModuleManifest } from '../types';

export const productsManifest: ModuleManifest = {
  key: 'products',
  label: 'Product Manager',
  data_buckets: ['products'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: true,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/products', label: 'Product Manager', viewKeys: ['products.products.view'], order: 10, skipEnableCheck: true },
  ],
};
