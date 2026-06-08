import type { ProductManifest } from '../types';

export const productsProduct: ProductManifest = {
  key: 'products',
  label: 'Products Management',
  modules: [
    { module: 'products', side: 'both' },
  ],
};
