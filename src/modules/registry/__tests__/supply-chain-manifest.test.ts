import { describe, it, expect } from 'vitest';
import { getModule } from '../modules';
import { getProduct } from '../products';
import { isValidPermissionKey } from '../../../../netlify/functions/_shared/permission-keys';

describe('supply-chain registry', () => {
  it('module registered: products bucket, view-only, vendor-side', () => {
    const m = getModule('supply-chain');
    expect(m).toBeTruthy();
    expect(m!.data_buckets).toEqual(['products']);
    expect(m!.verbs).toEqual(['view']);
    expect(m!.vendor_side).toBe(true);
  });

  it('product brings in the module', () => {
    const p = getProduct('supply-chain');
    expect(p).toBeTruthy();
    expect(p!.modules.some((r) => r.module === 'supply-chain')).toBe(true);
    expect(p!.requires).toBeUndefined();
  });

  it('supply-chain.products.view validates when the product is enabled', () => {
    expect(isValidPermissionKey('supply-chain.products.view', ['supply-chain'])).toBe(true);
  });

  it('rejects a bucket the module does not declare', () => {
    expect(isValidPermissionKey('supply-chain.business.view', ['supply-chain'])).toBe(false);
  });
});
