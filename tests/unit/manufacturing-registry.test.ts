import { describe, it, expect } from 'vitest';
import { getModule } from '../../src/modules/registry/modules';
import { getProduct, derivePermissionRows } from '../../src/modules/registry/products';

describe('manufacturing registry', () => {
  it('registers the manufacturing module with the products bucket', () => {
    const m = getModule('manufacturing');
    expect(m).toBeDefined();
    expect(m!.data_buckets).toEqual(['products']);
    expect(m!.vendor_side).toBe(true);
  });

  it('registers the manufacturing product requiring products + inventory', () => {
    const p = getProduct('manufacturing');
    expect(p).toBeDefined();
    expect(p!.modules.map((r) => r.module)).toContain('manufacturing');
    expect(p!.requires).toEqual(['products', 'inventory']);
  });

  it('derives a manufacturing.products permission row when enabled', () => {
    const rows = derivePermissionRows(['manufacturing']);
    const found = rows.find((r) => r.module.key === 'manufacturing' && r.bucket === 'products');
    expect(found).toBeDefined();
  });
});
