import { describe, it, expect } from 'vitest';
import { enabledModulesForProducts } from '../products';

describe('enabledModulesForProducts', () => {
  it('includes the POS module even though it declares no data_buckets', () => {
    // The bug: derivePermissionRows iterates data_buckets, so POS (which uses
    // the action-namespace and has data_buckets: []) was dropped from u-me's
    // enabled_modules. This helper iterates product.modules directly.
    const mods = enabledModulesForProducts(['products', 'pos']);
    expect(mods.map((m) => m.key)).toContain('pos');
  });

  it('returns {key,label} entries', () => {
    const pos = enabledModulesForProducts(['pos']).find((m) => m.key === 'pos');
    expect(pos).toBeTruthy();
    expect(pos!.label).toBe('POS');
  });

  it('dedupes a module shared across multiple products', () => {
    const keys = enabledModulesForProducts(['products', 'products']).map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ignores unknown product keys and returns [] for none', () => {
    expect(enabledModulesForProducts(['does-not-exist'])).toEqual([]);
    expect(enabledModulesForProducts([])).toEqual([]);
  });
});
