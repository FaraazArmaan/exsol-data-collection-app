import type { ModuleManifest } from '../types';

export const portfolioManifest: ModuleManifest = {
  key: 'portfolio',
  label: 'Brand Portfolio Site',
  data_buckets: ['business'],
  verbs: ['view', 'edit'],
  vendor_side: true,
  customer_side: true,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/brand-site', label: 'Brand Site', viewKeys: ['portfolio.business.view'], order: 160 },
  ],
};
