import type { ModuleManifest } from '../types';

// Catalog Website — a customer-facing public catalog (/catalog/:slug) that reuses
// the storefront menu grid minus the cart. It has no authed vendor surface and no
// grantable permissions (data_buckets: []); access is purely public, gated by the
// `catalog` Product being enabled for the client (client_enabled_products).
export const catalogManifest: ModuleManifest = {
  key: 'catalog',
  label: 'Catalog Website',
  data_buckets: [],
  verbs: ['view'],
  vendor_side: false,
  customer_side: true,
};
