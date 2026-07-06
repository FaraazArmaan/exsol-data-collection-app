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

export const PLATFORM_SURFACES = ['users', 'structure', 'settings', 'files', 'workspace'] as const;
export type PlatformSurface = (typeof PLATFORM_SURFACES)[number];

export type ModuleKey = string; // narrowed by the registry's keyof

// POS uses an action-namespaced key shape because its operations
// (markPaid, fulfill, refund, …) are not CRUD verbs over data_buckets.
// Other modules still use `<module>.<bucket>.<verb>`; POS adds a third
// pattern to the union.
export const POS_ACTIONS = [
  'menu.view',
  'sale.create',
  'sale.markPaid',
  'sale.fulfill',
  'sale.cancel',
  'sale.refund',
  'history.view',
  'history.viewAll',
] as const;
export type PosAction = (typeof POS_ACTIONS)[number];

export type PermissionKey =
  | `${ModuleKey}.${DataBucket}.${Verb}`
  | `_platform.${PlatformSurface}.${Verb}`
  | `pos.${PosAction}`;

// A dedicated sidebar link rendered by the user-portal Sidebar.tsx. Modules
// with dedicated nav are excluded from the generic /m/:key Modules rail so the
// same module never renders twice (see user-portal/nav/useNavItems.ts).
export interface ModuleNavLink {
  /** Route under /c/:slug, e.g. '/pos/menu'. */
  path: string;
  /** Sidebar link text (may differ from the module label, e.g. 'Product Manager'). */
  label: string;
  /**
   * Non-Owner users see the link iff ANY of these keys is true in their
   * permission matrix. L1 Owners (level_number === 1 or null) always qualify.
   */
  viewKeys: ReadonlyArray<PermissionKey>;
  /** Sidebar sort index — preserves the historical hardcoded link order. */
  order: number;
  /**
   * Legacy quirk (preserved as-is): the Product Manager link renders without
   * checking client_enabled_products. Every other link requires the module to
   * be enabled for the workspace.
   */
  skipEnableCheck?: boolean;
}

export interface ModuleManifest {
  key: ModuleKey;
  label: string;
  data_buckets: ReadonlyArray<DataBucket>;
  verbs: ReadonlyArray<Verb>;
  vendor_side: boolean;
  customer_side: boolean;
  /**
   * True ⇒ the module is kept OUT of the generic /m/:key Modules rail.
   * Either it renders its own sidebar link(s) via `navLinks`, or its surface
   * lives entirely outside the dashboard rail (catalog = public /catalog/:slug,
   * data-collection = onboarding wizard, project-service = folded into the
   * Workforce link). Modules without this flag appear in the generic rail.
   */
  hasDedicatedNav?: boolean;
  /** Dedicated sidebar links; requires hasDedicatedNav. */
  navLinks?: ReadonlyArray<ModuleNavLink>;
}

export type ProductModuleSide = 'vendor' | 'customer' | 'both' | 'none';

export interface ProductManifest {
  key: string;
  label: string;
  modules: ReadonlyArray<{ module: ModuleKey; side: ProductModuleSide }>;
  requires?: ReadonlyArray<string>;
  permissions?: ReadonlyArray<{ key: PermissionKey; label: string }>;
}
