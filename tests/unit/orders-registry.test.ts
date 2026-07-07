import { describe, it, expect } from 'vitest';
import { getModule } from '../../src/modules/registry/modules';
import { getProduct, derivePermissionRows } from '../../src/modules/registry/products';

describe('orders registry', () => {
  it('registers the orders module with the business bucket', () => {
    const m = getModule('orders');
    expect(m).toBeDefined();
    expect(m!.data_buckets).toEqual(['business']);
    expect(m!.vendor_side).toBe(true);
    expect(m!.hasDedicatedNav).toBe(true);
  });

  it('registers the orders product requiring pos', () => {
    const p = getProduct('orders');
    expect(p).toBeDefined();
    expect(p!.modules.map((r) => r.module)).toContain('orders');
    expect(p!.requires).toEqual(['pos']);
  });

  it('derives an orders.business permission row when enabled', () => {
    const rows = derivePermissionRows(['orders']);
    const found = rows.find((r) => r.module.key === 'orders' && r.bucket === 'business');
    expect(found).toBeDefined();
  });
});
