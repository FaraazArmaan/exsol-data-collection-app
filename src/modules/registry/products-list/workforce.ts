import type { ProductManifest } from '../types';

// Workforce Product — brings in the Workforce module (staff/shifts) and the
// Project Service module (projects + assignments). Requires 'saloon-booking' because
// both modules consume booking_resources (named staff/rooms). Without this
// ProductManifest the modules are invisible and keys never validate (Iron Rule 4).
export const workforceProduct: ProductManifest = {
  key: 'workforce',
  label: 'Workforce & Projects',
  modules: [
    { module: 'workforce', side: 'vendor' },
    { module: 'project-service', side: 'vendor' },
  ],
  requires: ['saloon-booking'],
};
