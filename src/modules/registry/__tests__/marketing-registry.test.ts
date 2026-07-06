import { describe, it, expect } from 'vitest';
import { getModule } from '../modules';
import { getProduct } from '../products';
import { isValidPermissionKey } from '../../../../netlify/functions/_shared/permission-keys';

describe('marketing registry', () => {
  it('registers the marketing module', () => {
    const m = getModule('marketing');
    expect(m?.data_buckets).toContain('customers');
    expect(m?.verbs).toEqual(expect.arrayContaining(['view', 'create', 'edit']));
    expect(m?.vendor_side).toBe(true);
  });
  it('registers the marketing product referencing the module', () => {
    expect(getProduct('marketing')?.modules.map((r) => r.module)).toContain('marketing');
  });
  it('validates marketing bucket×verb keys when enabled', () => {
    expect(isValidPermissionKey('marketing.customers.view', ['marketing'])).toBe(true);
    expect(isValidPermissionKey('marketing.customers.edit', ['marketing'])).toBe(true);
    expect(isValidPermissionKey('marketing.customers.view', [])).toBe(false);
    expect(isValidPermissionKey('marketing.products.view', ['marketing'])).toBe(false);
  });
});
