import type { ProductManifest } from '../types';

export const saloonBookingProduct: ProductManifest = {
  key: 'saloon-booking',
  label: 'Saloon Booking System',
  modules: [
    { module: 'booking',  side: 'both' },
    { module: 'payments', side: 'both' },
    { module: 'products', side: 'both' },
    { module: 'email',    side: 'vendor' },
  ],
};
