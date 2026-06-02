// src/modules/registry/types.ts
//
// Source of truth for the manifest type system used by:
//   - the per-Client Access Level Dashboard (UI generates rows from these),
//   - the requirePermission middleware (server validates keys against these),
//   - the admin "enable Products per Client" page.
//
// PermissionKey is the wire-format string used in the client_levels.permissions
// JSONB and in the requirePermission(key) call: '<module>.<bucket>.<verb>'
// for Module-scoped permissions, or '_platform.<surface>.<verb>' for fixed
// platform surfaces that don't belong to any Module.

export const DATA_BUCKETS = ['business', 'employees', 'customers', 'products'] as const;
export type DataBucket = (typeof DATA_BUCKETS)[number];

export const VERBS = ['view', 'create', 'edit', 'delete'] as const;
export type Verb = (typeof VERBS)[number];

export const PLATFORM_SURFACES = ['users', 'structure', 'settings'] as const;
export type PlatformSurface = (typeof PLATFORM_SURFACES)[number];

export type ModuleKey = string; // narrowed by the registry's keyof

export type PermissionKey =
  | `${ModuleKey}.${DataBucket}.${Verb}`
  | `_platform.${PlatformSurface}.${Verb}`;

export interface ModuleManifest {
  key: ModuleKey;
  label: string;
  data_buckets: ReadonlyArray<DataBucket>;
  verbs: ReadonlyArray<Verb>;
  vendor_side: boolean;
  customer_side: boolean;
}

export type ProductModuleSide = 'vendor' | 'customer' | 'both' | 'none';

export interface ProductManifest {
  key: string;
  label: string;
  modules: ReadonlyArray<{ module: ModuleKey; side: ProductModuleSide }>;
}
