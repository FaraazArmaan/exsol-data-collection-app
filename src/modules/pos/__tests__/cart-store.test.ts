// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createCartStore } from '../store/cart';

const sampleProduct = (id = 'p1', price = 22000, name = 'Cap') => ({
  id, name, categoryId: null, salePriceCents: price, thumbKey: null,
});

describe('cart store', () => {
  let store: ReturnType<typeof createCartStore>;
  beforeEach(() => {
    localStorage.clear();
    store = createCartStore('bucket1', 'user1');
  });

  it('addLine dedups by productId and snapshots first price', () => {
    const s = store.getState();
    s.addLine(sampleProduct('p1', 100));
    s.addLine(sampleProduct('p1', 999));
    const lines = store.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty).toBe(2);
    expect(lines[0]!.unitPriceCentsSnap).toBe(100);
  });

  it('setQty(0) removes line', () => {
    store.getState().addLine(sampleProduct('p1'));
    store.getState().setQty('p1', 0);
    expect(store.getState().lines).toHaveLength(0);
  });

  it('subtotalCents = sum(qty * snap)', () => {
    store.getState().addLine(sampleProduct('p1', 100));
    store.getState().setQty('p1', 3);
    store.getState().addLine(sampleProduct('p2', 50));
    expect(store.getState().subtotalCents()).toBe(3 * 100 + 50);
  });

  it('itemCount sums qty', () => {
    store.getState().addLine(sampleProduct('p1'));
    store.getState().setQty('p1', 3);
    store.getState().addLine(sampleProduct('p2'));
    expect(store.getState().itemCount()).toBe(4);
  });

  it('isValidForSubmit requires lines + name + phone', () => {
    const s = store.getState();
    expect(s.isValidForSubmit().ok).toBe(false);
    s.addLine(sampleProduct());
    expect(store.getState().isValidForSubmit().ok).toBe(false);
    s.setCustomer({ name: 'R' });
    expect(store.getState().isValidForSubmit().ok).toBe(false);
    s.setCustomer({ phone: '1' });
    expect(store.getState().isValidForSubmit().ok).toBe(true);
  });

  it('isValidForSubmit rejects malformed email but allows empty', () => {
    const s = store.getState();
    s.addLine(sampleProduct());
    s.setCustomer({ name: 'R', phone: '1' });
    expect(store.getState().isValidForSubmit().ok).toBe(true);
    s.setCustomer({ email: 'not-an-email' });
    expect(store.getState().isValidForSubmit().ok).toBe(false);
    s.setCustomer({ email: 'r@x.com' });
    expect(store.getState().isValidForSubmit().ok).toBe(true);
    s.setCustomer({ email: '' });
    expect(store.getState().isValidForSubmit().ok).toBe(true);
  });

  it('idempotencyKey persists across operations, regenerates after clear()', () => {
    const s = store.getState();
    s.addLine(sampleProduct('p1'));
    const k1 = store.getState().idempotencyKey;
    s.addLine(sampleProduct('p2'));
    expect(store.getState().idempotencyKey).toBe(k1);
    s.clear();
    s.addLine(sampleProduct('p1'));
    expect(store.getState().idempotencyKey).not.toBe(k1);
  });

  it('persists to localStorage', () => {
    store.getState().addLine(sampleProduct('p1'));
    const stored = JSON.parse(localStorage.getItem('pos-cart:bucket1:user1') || '{}');
    expect(stored.state?.lines).toHaveLength(1);
  });

  it('different (bucket, user) → separate carts', () => {
    store.getState().addLine(sampleProduct('p1'));
    const other = createCartStore('bucket2', 'user1');
    expect(other.getState().lines).toHaveLength(0);
  });
});
