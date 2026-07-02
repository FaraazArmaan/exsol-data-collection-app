import type { ProductManifest } from '../types';

// The Finance Product brings in the `finance` module. Enabling it for a Client
// surfaces the four finance.business.<verb> rows in the access-level dashboard
// and makes those keys valid for the permissions endpoint.
//
// No `requires`: the P&L reads whatever revenue exists (sales + bookings) and
// simply shows zeros for channels with no data — it can be enabled standalone.
export const financeProduct: ProductManifest = {
  key: 'finance',
  label: 'Finance',
  modules: [
    { module: 'finance', side: 'vendor' },
  ],
};
