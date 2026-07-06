import type { ProductManifest } from '../types';

export const brandPortfolioProduct: ProductManifest = {
  key: 'brand-portfolio',
  label: 'Brand Portfolio Sites',
  modules: [
    { module: 'portfolio', side: 'both' },
  ],
};
