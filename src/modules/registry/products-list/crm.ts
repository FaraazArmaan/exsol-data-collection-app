import type { ProductManifest } from '../types';

export const crmProduct: ProductManifest = {
  key: 'crm',
  label: 'Customer Relationship Management',
  modules: [{ module: 'crm', side: 'vendor' }],
};
