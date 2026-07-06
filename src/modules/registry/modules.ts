//
// Central registry of all Module manifests. Adding a Module = adding one
// manifest file + one line here. The registry shape (Record keyed by module
// key) lets callers do both list-iteration (allModules) and direct lookup
// (getModule / moduleRegistry.foo).

import type { ModuleManifest } from './types';
import { bookingManifest } from './manifests/booking';
import { paymentsManifest } from './manifests/payments';
import { productsManifest } from './manifests/products';
import { posManifest } from './manifests/pos';
import { analyticsManifest } from './manifests/analytics';
import { inventoryManifest } from './manifests/inventory';
import { emailManifest } from './manifests/email';
import { financeManifest } from './manifests/finance';
import { manufacturingManifest } from './manifests/manufacturing';
import { procurementManifest } from './manifests/procurement';
import { warehouseManifest } from './manifests/warehouse';
import { crmManifest } from './manifests/crm';
import { workforceManifest } from './manifests/workforce';
import { projectServiceManifest } from './manifests/project-service';

export const moduleRegistry = {
  booking: bookingManifest,
  payments: paymentsManifest,
  products: productsManifest,
  pos: posManifest,
  analytics: analyticsManifest,
  inventory: inventoryManifest,
  email: emailManifest,
  finance: financeManifest,
  manufacturing: manufacturingManifest,
  procurement: procurementManifest,
  warehouse: warehouseManifest,
  crm: crmManifest,
  workforce: workforceManifest,
  'project-service': projectServiceManifest,
} as const satisfies Record<string, ModuleManifest>;

export type RegisteredModuleKey = keyof typeof moduleRegistry;

export function allModules(): ModuleManifest[] {
  return Object.values(moduleRegistry);
}

export function getModule(key: string): ModuleManifest | undefined {
  return (moduleRegistry as Record<string, ModuleManifest>)[key];
}
