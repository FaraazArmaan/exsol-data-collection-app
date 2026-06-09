import { describe, expect, test } from 'vitest';
import {
  productThumbKeyFor,
  THUMB_MAX_EDGE,
  THUMB_QUALITY,
  THUMB_CACHE_SECONDS,
  THUMB_FALLBACK_CACHE_SECONDS,
} from '../../netlify/functions/_shared/products-thumbnails';

describe('products-thumbnails helpers', () => {
  test('productThumbKeyFor prefixes with thumb/ and suffixes .webp', () => {
    const src = 'product-images/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/cccccccc-cccc-cccc-cccc-cccccccccccc';
    expect(productThumbKeyFor(src)).toBe(`thumb/${src}.webp`);
  });

  test('productThumbKeyFor is idempotent in spirit — calling on its own result is detectable as already-prefixed but does not double-prefix because callers must only pass source keys', () => {
    // The function does not defensively un-double. Callers MUST pass a source
    // blob_key, never a thumb key. This test pins the contract.
    const src = 'product-images/a/b/c';
    const once = productThumbKeyFor(src);
    expect(once.startsWith('thumb/')).toBe(true);
    expect(once.endsWith('.webp')).toBe(true);
    // Double-prefix is a bug at the call site if it happens; we just document.
    expect(productThumbKeyFor(once)).toBe(`thumb/${once}.webp`);
  });

  test('constants have the expected values', () => {
    expect(THUMB_MAX_EDGE).toBe(240);
    expect(THUMB_QUALITY).toBe(80);
    expect(THUMB_CACHE_SECONDS).toBe(2_592_000); // 30 days
    expect(THUMB_FALLBACK_CACHE_SECONDS).toBe(300); // 5 minutes
  });
});
