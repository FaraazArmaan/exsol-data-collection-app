import type { ModuleManifest } from '../types';

// Project Service — project management with optional CRM customer linkage.
// Uses 'business' bucket for projects themselves, 'customers' for project-customer links.
// Keys: project-service.business.{view,create,edit,delete} + project-service.customers.view.
export const projectServiceManifest: ModuleManifest = {
  key: 'project-service',
  label: 'Project Service',
  data_buckets: ['business', 'customers'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
};
