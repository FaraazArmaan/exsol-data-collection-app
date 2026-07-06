//
// Product registry + the matrix-row derivation helper used by:
//   - AccessLevelDashboard UI (generates the per-Level row list),
//   - client-levels-permissions endpoint (validates which keys are accepted).

import type { ProductManifest, ModuleManifest, DataBucket } from './types';
import { getModule } from './modules';
import { saloonBookingProduct } from './products-list/saloon-booking';
import { productsProduct } from './products-list/products';
import { posProduct } from './products-list/pos';
import { analyticsProduct } from './products-list/analytics';
import { inventoryProduct } from './products-list/inventory';
import { financeProduct } from './products-list/finance';
import { procurementProduct } from './products-list/procurement';
import { warehouseProduct } from './products-list/warehouse';

export const productRegistry = {
  'saloon-booking': saloonBookingProduct,
  'products': productsProduct,
  'pos': posProduct,
  'analytics': analyticsProduct,
  'inventory': inventoryProduct,
  'finance': financeProduct,
  'procurement': procurementProduct,
  'warehouse': warehouseProduct,
} as const satisfies Record<string, ProductManifest>;

export function allProducts(): ProductManifest[] {
  return Object.values(productRegistry);
}

export function getProduct(key: string): ProductManifest | undefined {
  return (productRegistry as Record<string, ProductManifest>)[key];
}

export interface PermissionRow {
  module: ModuleManifest;
  bucket: DataBucket;
}

export interface ActionPermissionGroup {
  product_key: string;
  label: string;
  actions: { key: string; label: string }[];
}

/**
 * Action-namespace permission groups for the enabled Products — one group per
 * Product that declares a `permissions` list (e.g. POS's `pos.<action>` keys).
 * The Access Level Dashboard renders these as per-action toggles, separate
 * from the `<module>.<bucket>.<verb>` grid. Product-agnostic.
 */
// A product's action permissions are only grantable if its declared `requires`
// (dependency products) are ALSO enabled — defense-in-depth so e.g. pos.* can't
// be granted when `products` (pos's dependency) is somehow off.
function requiresSatisfied(
  product: { requires?: ReadonlyArray<string> },
  enabled: ReadonlySet<string>,
): boolean {
  return !product.requires || product.requires.every((r) => enabled.has(r));
}

export function actionPermissionGroups(
  enabledProductKeys: readonly string[],
): ActionPermissionGroup[] {
  const enabled = new Set(enabledProductKeys);
  const out: ActionPermissionGroup[] = [];
  for (const pKey of enabledProductKeys) {
    const product = getProduct(pKey);
    if (!product?.permissions || product.permissions.length === 0) continue;
    if (!requiresSatisfied(product, enabled)) continue;
    out.push({
      product_key: product.key,
      label: product.label,
      actions: product.permissions.map((p) => ({ key: p.key, label: p.label })),
    });
  }
  return out;
}

/**
 * Flat set of valid action-namespace permission keys for the enabled Products.
 * Used by isValidPermissionKey to accept action keys, which don't follow the
 * `<module>.<bucket>.<verb>` shape.
 */
export function actionPermissionKeys(enabledProductKeys: readonly string[]): Set<string> {
  const enabled = new Set(enabledProductKeys);
  const set = new Set<string>();
  for (const pKey of enabledProductKeys) {
    const product = getProduct(pKey);
    if (!product?.permissions) continue;
    if (!requiresSatisfied(product, enabled)) continue;
    for (const p of product.permissions) set.add(p.key);
  }
  return set;
}

/**
 * Given the set of Product keys a Client has enabled, return the deduplicated
 * list of Modules they bring in, as `{ key, label }`. Unlike
 * derivePermissionRows (which enumerates data_buckets and therefore drops
 * action-namespace modules like POS that declare `data_buckets: []`), this
 * walks `product.modules` directly — so every enabled Module is represented.
 * Used by /api/u-me's enabled_modules.
 */
export function enabledModulesForProducts(
  enabledProductKeys: readonly string[],
): { key: string; label: string }[] {
  const map = new Map<string, { key: string; label: string }>();
  for (const pKey of enabledProductKeys) {
    const product = getProduct(pKey);
    if (!product) continue;
    for (const ref of product.modules) {
      const module = getModule(ref.module);
      if (!module) continue;
      if (!map.has(module.key)) map.set(module.key, { key: module.key, label: module.label });
    }
  }
  return Array.from(map.values());
}

/**
 * Given the set of Product keys a Client has enabled, return the deduplicated
 * list of (Module, DataBucket) rows the Primary should see in the Access
 * Level Dashboard. Order is stable: products in registration order, then
 * modules in product-declaration order, then buckets in manifest-declaration
 * order.
 */
export function derivePermissionRows(enabledProductKeys: readonly string[]): PermissionRow[] {
  const seen = new Set<string>();
  const out: PermissionRow[] = [];
  for (const pKey of enabledProductKeys) {
    const product = getProduct(pKey);
    if (!product) continue;
    for (const ref of product.modules) {
      const module = getModule(ref.module);
      if (!module) continue;
      for (const bucket of module.data_buckets) {
        const key = `${module.key}.${bucket}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ module, bucket });
      }
    }
  }
  return out;
}
