import type { ModuleManifest } from '../types';

// Supply Chain — a read-only cross-module dashboard over Inventory, Procurement,
// and Manufacturing. All three are product-catalog data, so it uses the 'products'
// bucket → the single key supply-chain.products.view. Toggle per client via the
// `supply-chain` Product (see products-list/supply-chain.ts).
export const supplyChainManifest: ModuleManifest = {
  key: 'supply-chain',
  label: 'Supply Chain',
  data_buckets: ['products'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/supply-chain', label: 'Supply Chain', viewKeys: ['supply-chain.products.view'], order: 100 },
  ],
};
