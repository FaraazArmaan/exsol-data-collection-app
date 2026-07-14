import type { ProductManifest } from '../types';

export const saloonBookingProduct: ProductManifest = {
  key: 'saloon-booking',
  // Stable product key retained for enabled-workspace and dependency compatibility.
  label: 'Appointments & Reservations',
  modules: [
    { module: 'booking',  side: 'both' },
    { module: 'payments', side: 'both' },
    { module: 'products', side: 'both' },
    { module: 'email',    side: 'vendor' },
  ],
};
