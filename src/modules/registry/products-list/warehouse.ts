import type { ProductManifest } from '../types';

// Warehouse Product — brings in the Warehouse module (vendor side). Requires the
// `inventory` Product because warehouse is a locations layer over inventory stock
// (which itself requires `products`). Without this ProductManifest the module is
// invisible and its keys never validate (Iron Rule 4).
export const warehouseProduct: ProductManifest = {
  key: 'warehouse',
  label: 'Warehouse',
  modules: [{ module: 'warehouse', side: 'vendor' }],
  requires: ['inventory'],
};
