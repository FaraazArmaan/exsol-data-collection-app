// netlify/functions/_shared/permission-keys.ts
//
// Used by:
//   - PUT /api/client-levels-permissions to reject unknown / forbidden keys,
//   - requirePermission middleware to parse the key into (module, bucket, verb)
//     before looking it up in the matrix.

import {
  VERBS, PLATFORM_SURFACES, type Verb, type DataBucket, type PlatformSurface,
} from '../../../src/modules/registry/types';
import { getModule } from '../../../src/modules/registry/modules';
import { getProduct, actionPermissionKeys } from '../../../src/modules/registry/products';

export type ParsedPermissionKey =
  | { scope: 'module'; module: string; bucket: DataBucket; verb: Verb }
  | { scope: 'platform'; surface: PlatformSurface; verb: Verb };

export function splitPermissionKey(key: string): ParsedPermissionKey | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  const [head, mid, verb] = parts as [string, string, string];
  if (!(VERBS as readonly string[]).includes(verb)) return null;

  if (head === '_platform') {
    if (!(PLATFORM_SURFACES as readonly string[]).includes(mid)) return null;
    return { scope: 'platform', surface: mid as PlatformSurface, verb: verb as Verb };
  }
  // Module-scoped key. We don't validate module/bucket existence here — that's
  // the caller's job (isValidPermissionKey). split is purely structural.
  return { scope: 'module', module: head, bucket: mid as DataBucket, verb: verb as Verb };
}

/**
 * Returns true if the key is structurally valid AND, for module-scoped keys,
 * the module is enabled by the given Product keys AND the bucket/verb appear
 * in the module's manifest.
 */
export function isValidPermissionKey(key: string, enabledProductKeys: readonly string[]): boolean {
  // Action-namespace keys (e.g. `pos.<action>`) don't follow the
  // <module>.<bucket>.<verb> shape — validate them against the enabled
  // Products' declared permission lists before the structural parse below.
  if (actionPermissionKeys(enabledProductKeys).has(key)) return true;

  const parsed = splitPermissionKey(key);
  if (!parsed) return false;
  if (parsed.scope === 'platform') return true; // surface + verb already vetted by split

  const module = getModule(parsed.module);
  if (!module) return false;

  // Module must be brought in by at least one enabled Product.
  const enabled = new Set<string>();
  for (const pKey of enabledProductKeys) {
    const product = getProduct(pKey);
    if (!product) continue;
    for (const ref of product.modules) enabled.add(ref.module);
  }
  if (!enabled.has(module.key)) return false;

  if (!module.data_buckets.includes(parsed.bucket)) return false;
  if (!module.verbs.includes(parsed.verb)) return false;
  return true;
}
