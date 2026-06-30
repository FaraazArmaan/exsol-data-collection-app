// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createCartStore, createGuestCartStore, type MenuProduct } from '../store/cart';

const product: MenuProduct = { id: 'p1', name: 'X', categoryId: null, salePriceCents: 100, thumbKey: null };

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

describe('guest cart store', () => {
  it('persists to sessionStorage under pos-cart-guest:<bucket>:<session>', () => {
    const useStore = createGuestCartStore('b1', 'sess1');
    useStore.getState().addLine(product);
    expect(sessionStorage.getItem('pos-cart-guest:b1:sess1')).toBeTruthy();
    expect(localStorage.getItem('pos-cart-guest:b1:sess1')).toBeNull();
  });

  it('defaults channel to pickup (instore is not a storefront channel)', () => {
    expect(createGuestCartStore('b1', 'sess1').getState().channel).toBe('pickup');
  });

  it('createCartStore routes a guest- prefixed user to the guest store', () => {
    const useStore = createCartStore('b1', 'guest-sess2');
    useStore.getState().addLine(product);
    expect(sessionStorage.getItem('pos-cart-guest:b1:sess2')).toBeTruthy();
    expect(localStorage.getItem('pos-cart:b1:guest-sess2')).toBeNull();
  });

  it('createCartStore keeps a normal staff user on localStorage', () => {
    const useStore = createCartStore('b1', 'u1');
    useStore.getState().addLine(product);
    expect(localStorage.getItem('pos-cart:b1:u1')).toBeTruthy();
    expect(useStore.getState().channel).toBe('instore');
  });
});
