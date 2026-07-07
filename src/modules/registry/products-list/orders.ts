import type { ProductManifest } from '../types';

// The Orders Product brings in the `orders` module.
// Requires `pos` — the orders dashboard reads from `public.sales`, which only
// exists (and is populated) when the POS product is active for the client.
export const ordersProduct: ProductManifest = {
  key: 'orders',
  label: 'Order Management',
  modules: [{ module: 'orders', side: 'vendor' }],
  requires: ['pos'],
};
