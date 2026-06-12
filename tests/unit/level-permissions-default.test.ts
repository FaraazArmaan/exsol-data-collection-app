// tests/unit/level-permissions-default.test.ts
//
// Unit tests for defaultPermissionsForLevel — the level-create defaults
// helper. L1 = all valid permission keys true; L2+ = empty.

import { defaultPermissionsForLevel } from '../../netlify/functions/_shared/level-permissions';

describe('defaultPermissionsForLevel', () => {
  test('L1 with no enabled products returns ONLY platform keys, all true', () => {
    const result = defaultPermissionsForLevel(1, []);
    // 5 platform surfaces × 4 verbs = 20 keys
    const keys = Object.keys(result);
    expect(keys.length).toBe(20);
    for (const k of keys) {
      expect(k.startsWith('_platform.')).toBe(true);
      expect(result[k]).toBe(true);
    }
  });

  test('L1 with a product enabled includes that module\'s buckets and verbs', () => {
    // 'products' product brings in the 'products' module (per registry).
    const result = defaultPermissionsForLevel(1, ['products']);
    // Should include at least one module-scoped key.
    const moduleKeys = Object.keys(result).filter((k) => !k.startsWith('_platform.'));
    expect(moduleKeys.length).toBeGreaterThan(0);
    for (const k of moduleKeys) expect(result[k]).toBe(true);
  });

  test('L2 returns empty regardless of enabled products', () => {
    expect(defaultPermissionsForLevel(2, [])).toEqual({});
    expect(defaultPermissionsForLevel(2, ['products', 'booking'])).toEqual({});
  });

  test('L5 returns empty (any level ≥ 2)', () => {
    expect(defaultPermissionsForLevel(5, ['products'])).toEqual({});
  });
});
