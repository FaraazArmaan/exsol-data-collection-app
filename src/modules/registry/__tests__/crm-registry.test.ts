import { describe, it, expect } from 'vitest';
import { getModule } from '../modules';
import { getProduct } from '../products';
import { isValidPermissionKey } from '../../../../netlify/functions/_shared/permission-keys';

describe('crm registry', () => {
  it('registers the crm module', () => {
    const m = getModule('crm');
    expect(m?.data_buckets).toContain('customers');
    expect(m?.verbs).toEqual(expect.arrayContaining(['view', 'create', 'edit', 'delete']));
    expect(m?.vendor_side).toBe(true);
  });
  it('registers the crm product referencing the module', () => {
    const p = getProduct('crm');
    expect(p?.modules.map((r) => r.module)).toContain('crm');
  });
  it('validates crm bucket×verb keys when the crm product is enabled', () => {
    expect(isValidPermissionKey('crm.customers.view', ['crm'])).toBe(true);
    expect(isValidPermissionKey('crm.customers.delete', ['crm'])).toBe(true);
    expect(isValidPermissionKey('crm.customers.view', [])).toBe(false);
    expect(isValidPermissionKey('crm.products.view', ['crm'])).toBe(false); // crm has no 'products' bucket
  });
});
