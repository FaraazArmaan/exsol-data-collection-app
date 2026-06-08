// Default permissions JSON for a newly-created level.
// L1 = all valid permission keys for the workspace's enabled products, true.
// L2+ = empty object (admin explicitly grants in /access-levels).
//
// Permission keys enumerate from the active module manifests for the
// workspace's enabled products — same source the /access-levels page reads.

import { PLATFORM_SURFACES, VERBS } from '../../../src/modules/registry/types';
import { getModule } from '../../../src/modules/registry/modules';
import { getProduct } from '../../../src/modules/registry/products';

export function defaultPermissionsForLevel(
  levelNumber: number,
  enabledProductKeys: readonly string[],
): Record<string, boolean> {
  if (levelNumber !== 1) return {};

  const all: Record<string, boolean> = {};

  // Platform surfaces × verbs (always present, independent of products).
  for (const surface of PLATFORM_SURFACES) {
    for (const verb of VERBS) {
      all[`_platform.${surface}.${verb}`] = true;
    }
  }

  // Modules brought in by enabled products.
  const enabledModules = new Set<string>();
  for (const pKey of enabledProductKeys) {
    const product = getProduct(pKey);
    if (!product) continue;
    for (const ref of product.modules) enabledModules.add(ref.module);
  }

  for (const mKey of enabledModules) {
    const m = getModule(mKey);
    if (!m) continue;
    for (const bucket of m.data_buckets) {
      for (const verb of m.verbs) {
        all[`${m.key}.${bucket}.${verb}`] = true;
      }
    }
  }

  return all;
}
