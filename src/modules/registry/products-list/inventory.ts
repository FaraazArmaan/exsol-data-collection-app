import type { ProductManifest } from '../types';

// Inventory Product — brings in the Inventory module (vendor side). Requires the
// `products` Product because stock is tracked against catalog products. Without
// this ProductManifest the module is invisible and its keys never validate
// (Iron Rule 4).
export const inventoryProduct: ProductManifest = {
  key: 'inventory',
  label: 'Inventory',
  modules: [{ module: 'inventory', side: 'vendor' }],
  requires: ['products'],
};
