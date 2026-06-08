//
// Product registry + the matrix-row derivation helper used by:
//   - AccessLevelDashboard UI (generates the per-Level row list),
//   - client-levels-permissions endpoint (validates which keys are accepted).

import type { ProductManifest, ModuleManifest, DataBucket } from './types';
import { getModule } from './modules';
import { saloonBookingProduct } from './products-list/saloon-booking';
import { productsProduct } from './products-list/products';

export const productRegistry = {
  'saloon-booking': saloonBookingProduct,
  'products': productsProduct,
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
