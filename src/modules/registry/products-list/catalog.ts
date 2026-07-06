import type { ProductManifest } from '../types';

// Catalog Website Product — brings in the catalog module (customer side). Requires
// `products` (it renders the product catalog). Enabling it makes /catalog/:slug
// public for the client. Without this ProductManifest the module is invisible
// and the public route's enablement gate never matches (Iron Rule 4).
export const catalogProduct: ProductManifest = {
  key: 'catalog',
  label: 'Catalog Website',
  modules: [{ module: 'catalog', side: 'customer' }],
  requires: ['products'],
};
