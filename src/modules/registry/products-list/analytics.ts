import type { ProductManifest } from '../types';

// The Analytics Product brings in the read-only `analytics` module. Enabling it
// for a Client surfaces the four `analytics.<bucket>.view` rows in the access
// level dashboard and makes those keys valid for the permissions endpoint.
//
// No `requires`: analytics is a pure read projection over whatever data exists.
// It can be enabled standalone — it simply shows zeros for domains with no data
// (e.g. no Bookings) rather than depending on another Product being installed.
export const analyticsProduct: ProductManifest = {
  key: 'analytics',
  label: 'Analytics',
  modules: [
    { module: 'analytics', side: 'vendor' },
  ],
};
