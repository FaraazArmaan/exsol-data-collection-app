import type { ModuleManifest } from '../types';

// Warehouse — vendor-side locations layer over Inventory stock. Two buckets from
// the fixed DataBucket set: 'business' for the locations themselves (warehouse
// infrastructure) and 'products' for the per-location stock (view + transfer).
// Keys: warehouse.business.{view,create,edit,delete} + warehouse.products.{view,edit}.
// (products.create/delete exist in the grid but no endpoint uses them — stock rows
// are only ever moved by a transfer, never hand-created/deleted. Toggleable per
// client via the `warehouse` Product enablement, which requires `inventory`.)
export const warehouseManifest: ModuleManifest = {
  key: 'warehouse',
  label: 'Warehouse',
  data_buckets: ['business', 'products'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/warehouse', label: 'Warehouse', viewKeys: ['warehouse.business.view', 'warehouse.products.view'], order: 140 },
  ],
};
