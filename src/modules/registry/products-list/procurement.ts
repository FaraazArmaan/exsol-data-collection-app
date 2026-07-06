import type { ProductManifest } from '../types';

// Procurement Product — brings in the Procurement module (vendor side). Requires
// `products` (POs reference catalog products) and `inventory` (receiving a PO
// increments inventory_stock + writes a stock_movement). Without this
// ProductManifest the module is invisible and its keys never validate (Iron Rule 4).
export const procurementProduct: ProductManifest = {
  key: 'procurement',
  label: 'Procurement',
  modules: [{ module: 'procurement', side: 'vendor' }],
  requires: ['products', 'inventory'],
};
