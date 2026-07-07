import type { ProductManifest } from '../types';

// HR is a standalone product (like finance) — it reads user_nodes / workforce
// data but has no hard product dependency. Keeping it standalone means enabling
// it doesn't drag in other modules and doesn't perturb existing product bundles.
export const hrProduct: ProductManifest = {
  key: 'hr',
  label: 'Human Resources',
  modules: [{ module: 'hr', side: 'vendor' }],
};
