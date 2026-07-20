import { describe, expect, it } from 'vitest';
import { isCatalogSellable } from '../../netlify/functions/_shared/catalog-read-model';

const active = { status: 'active', deleted_at: null, pos_visible: true, storefront_visible: true };

describe('catalog read model — current sellability contract', () => {
  it('requires active, non-deleted products for every catalog channel', () => {
    for (const channel of ['pos', 'storefront', 'catalog'] as const) {
      expect(isCatalogSellable({ ...active, status: 'draft' }, channel)).toBe(false);
      expect(isCatalogSellable({ ...active, deleted_at: '2026-07-18T00:00:00.000Z' }, channel)).toBe(false);
    }
  });

  it('applies the existing POS/storefront visibility split and preserves Catalog Website behavior', () => {
    expect(isCatalogSellable({ ...active, pos_visible: false }, 'pos')).toBe(false);
    expect(isCatalogSellable({ ...active, storefront_visible: false }, 'storefront')).toBe(false);
    expect(isCatalogSellable({ ...active, storefront_visible: false }, 'catalog')).toBe(true);
  });
});
