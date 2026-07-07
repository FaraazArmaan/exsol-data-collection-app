import { describe, it, expect } from 'vitest';
import { getModule } from '../../src/modules/registry/modules';
import { getProduct, derivePermissionRows } from '../../src/modules/registry/products';

describe('manufacturing registry', () => {
  it('registers the manufacturing module with the products + business buckets', () => {
    const m = getModule('manufacturing');
    expect(m).toBeDefined();
    // depth added 'business' for shop-floor ops (maintenance/downtime, capacity)
    expect(m!.data_buckets).toEqual(['products', 'business']);
    expect(m!.vendor_side).toBe(true);
  });

  it('registers the manufacturing product requiring products + inventory', () => {
    const p = getProduct('manufacturing');
    expect(p).toBeDefined();
    expect(p!.modules.map((r) => r.module)).toContain('manufacturing');
    expect(p!.requires).toEqual(['products', 'inventory']);
  });

  it('derives manufacturing.products + manufacturing.business permission rows when enabled', () => {
    const rows = derivePermissionRows(['manufacturing']);
    expect(rows.find((r) => r.module.key === 'manufacturing' && r.bucket === 'products')).toBeDefined();
    expect(rows.find((r) => r.module.key === 'manufacturing' && r.bucket === 'business')).toBeDefined();
  });
});
