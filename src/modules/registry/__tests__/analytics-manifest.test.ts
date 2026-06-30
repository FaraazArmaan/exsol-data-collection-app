import { describe, it, expect } from 'vitest';
import { getModule } from '../modules';
import { getProduct, derivePermissionRows } from '../products';
import { isValidPermissionKey } from '../../../../netlify/functions/_shared/permission-keys';

describe('analytics module manifest', () => {
  it('is registered, view-only, over the four data buckets', () => {
    const m = getModule('analytics');
    expect(m).toBeDefined();
    expect(m!.verbs).toEqual(['view']);
    expect([...m!.data_buckets].sort()).toEqual(
      ['business', 'customers', 'employees', 'products'].sort(),
    );
  });
});

describe('analytics product manifest', () => {
  it('is registered and brings in the analytics module', () => {
    const p = getProduct('analytics');
    expect(p).toBeDefined();
    expect(p!.modules.map((r) => r.module)).toContain('analytics');
  });

  it('derives one permission row per analytics bucket when the product is enabled', () => {
    const rows = derivePermissionRows(['analytics']);
    const analyticsBuckets = rows
      .filter((r) => r.module.key === 'analytics')
      .map((r) => r.bucket)
      .sort();
    expect(analyticsBuckets).toEqual(
      ['business', 'customers', 'employees', 'products'].sort(),
    );
  });
});

describe('analytics permission-key validation', () => {
  it('accepts analytics.<bucket>.view only when the analytics product is enabled', () => {
    expect(isValidPermissionKey('analytics.business.view', ['analytics'])).toBe(true);
    expect(isValidPermissionKey('analytics.products.view', ['analytics'])).toBe(true);
    // analytics product not enabled → module not brought in → invalid
    expect(isValidPermissionKey('analytics.business.view', ['pos'])).toBe(false);
  });

  it('rejects non-view verbs (manifest declares view only)', () => {
    expect(isValidPermissionKey('analytics.business.edit', ['analytics'])).toBe(false);
    expect(isValidPermissionKey('analytics.business.create', ['analytics'])).toBe(false);
  });
});
