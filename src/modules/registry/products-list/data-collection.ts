import type { ProductManifest } from '../types';

// Data Collection Product — brings in the data-collection module (vendor side).
// Requires `products` (onboarding imports products). Enabling it surfaces the
// "Generate onboarding link" control in Product Manager. Without this
// ProductManifest the module is invisible and its keys never validate (Iron Rule 4).
export const dataCollectionProduct: ProductManifest = {
  key: 'data-collection',
  label: 'Data Collection',
  modules: [{ module: 'data-collection', side: 'vendor' }],
  requires: ['products'],
};
