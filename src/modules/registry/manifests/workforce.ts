import type { ModuleManifest } from '../types';

// Workforce — staff directory + recurring weekly shift schedule over booking resources.
// Uses 'employees' bucket for staff/shift data, 'business' for schedule configuration.
// Keys: workforce.employees.{view,create,edit,delete}.
export const workforceManifest: ModuleManifest = {
  key: 'workforce',
  label: 'Workforce',
  data_buckets: ['employees'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
};
