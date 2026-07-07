import type { ModuleManifest } from '../types';

// Inventory — vendor-side stock tracking over the product catalog. Uses the
// 'products' data bucket (the only bucket that makes sense for stock), so its
// permission keys are inventory.products.{view,create,edit,delete}. Toggleable
// per client via the `inventory` Product enablement (see products-list/inventory.ts).
export const inventoryManifest: ModuleManifest = {
  key: 'inventory',
  label: 'Inventory',
  data_buckets: ['products'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [
    // Dashboard is the landing surface; the stock list + other depth pages are
    // reached via the in-page InventoryTabs.
    { path: '/inventory/dashboard', label: 'Inventory', viewKeys: ['inventory.products.view'], order: 40 },
  ],
};
