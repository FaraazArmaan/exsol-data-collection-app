import type { ModuleManifest } from '../types';

// Procurement — vendor-side suppliers + purchase orders. Uses the 'products' data
// bucket (POs are placed against catalog products), so permission keys are
// procurement.products.{view,create,edit,delete}. Toggleable per client via the
// `procurement` Product (see products-list/procurement.ts).
export const procurementManifest: ModuleManifest = {
  key: 'procurement',
  label: 'Procurement',
  data_buckets: ['products'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
};
