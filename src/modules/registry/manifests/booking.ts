import type { ModuleManifest } from '../types';

export const bookingManifest: ModuleManifest = {
  key: 'booking',
  label: 'Booking & Calendar',
  data_buckets: ['customers', 'employees'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: true,
  hasDedicatedNav: true,
  navLinks: [
    { path: '/booking', label: 'Booking', viewKeys: ['booking.customers.view', 'booking.employees.view'], order: 30 },
  ],
};
