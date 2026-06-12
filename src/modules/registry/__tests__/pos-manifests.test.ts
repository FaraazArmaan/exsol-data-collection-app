import { describe, it, expect } from 'vitest';
import { getModule } from '../modules';
import { getProduct } from '../products';
import { POS_ACTIONS } from '../types';

describe('pos registry entries', () => {
  it('module is registered with key=pos', () => {
    const m = getModule('pos');
    expect(m).toBeDefined();
    expect(m?.key).toBe('pos');
    expect(m?.vendor_side).toBe(true);
    expect(m?.customer_side).toBe(false);
  });
  it('product is registered with requires=["products"]', () => {
    const p = getProduct('pos');
    expect(p).toBeDefined();
    expect(p?.requires).toEqual(['products']);
    expect(p?.permissions?.map((x) => x.key.replace(/^pos\./, ''))).toEqual([...POS_ACTIONS]);
  });
});
