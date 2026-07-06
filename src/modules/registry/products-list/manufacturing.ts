import type { ProductManifest } from '../types';

// Manufacturing Product — brings in the Manufacturing module (vendor side).
// Requires `products` (BOMs reference catalog products) and `inventory`
// (completion moves stock through the inventory ledger). Without this
// ProductManifest the module is invisible and keys never validate (Iron Rule 4).
export const manufacturingProduct: ProductManifest = {
  key: 'manufacturing',
  label: 'Manufacturing',
  modules: [{ module: 'manufacturing', side: 'vendor' }],
  requires: ['products', 'inventory'],
};
