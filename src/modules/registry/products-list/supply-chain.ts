import type { ProductManifest } from '../types';

// Standalone-enablable (no `requires`): the dashboard self-gates each panel on
// whether the backing module (inventory/procurement/manufacturing) is enabled.
export const supplyChainProduct: ProductManifest = {
  key: 'supply-chain',
  label: 'Supply Chain',
  modules: [
    { module: 'supply-chain', side: 'vendor' },
  ],
};
