//
// Central registry of all Module manifests. Adding a Module = adding one
// manifest file + one line here. The registry shape (Record keyed by module
// key) lets callers do both list-iteration (allModules) and direct lookup
// (getModule / moduleRegistry.foo).

import type { ModuleManifest } from './types';
import { bookingManifest } from './manifests/booking';
import { paymentsManifest } from './manifests/payments';

export const moduleRegistry = {
  booking: bookingManifest,
  payments: paymentsManifest,
} as const satisfies Record<string, ModuleManifest>;

export type RegisteredModuleKey = keyof typeof moduleRegistry;

export function allModules(): ModuleManifest[] {
  return Object.values(moduleRegistry);
}

export function getModule(key: string): ModuleManifest | undefined {
  return (moduleRegistry as Record<string, ModuleManifest>)[key];
}
