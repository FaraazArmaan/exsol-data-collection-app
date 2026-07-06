import type { ModuleManifest } from '../types';

// Data Collection — a vendor tool that mints public onboarding links; a guest
// visits /onboard/:token and bulk-imports products (CSV/XLSX) into the client's
// catalog. Uses the 'products' data bucket, so keys are
// data-collection.products.{view,create,edit,delete}. Toggleable per client via
// the `data-collection` Product.
export const dataCollectionManifest: ModuleManifest = {
  key: 'data-collection',
  label: 'Data Collection',
  data_buckets: ['products'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
};
