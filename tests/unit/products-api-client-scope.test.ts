import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { productsApi, categoriesApi, imagesApi } from '../../src/modules/products/shared/api';

const capturedUrls: string[] = [];
let originalFetch: typeof fetch;

beforeEach(() => {
  capturedUrls.length = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    capturedUrls.push(url);
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('products-api client scope threading', () => {
  test('productsApi.list without opts does not include client= param', async () => {
    await productsApi.list({ status: 'active' });
    expect(capturedUrls[0]).toContain('/api/u-products');
    expect(capturedUrls[0]).toContain('status=active');
    expect(capturedUrls[0]).not.toContain('client=');
  });

  test('productsApi.list with clientId appends ?client=<id> (merged with other params)', async () => {
    await productsApi.list({ status: 'active' }, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toContain('client=abc-123');
    expect(capturedUrls[0]).toContain('status=active');
  });

  test('productsApi.get with clientId appends ?client=<id>', async () => {
    await productsApi.get('prod-1', { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products/prod-1?client=abc-123');
  });

  test('productsApi.create with clientId POSTs to ?client=<id>', async () => {
    await productsApi.create({ name: 'X', type: 'physical', price_cents: 100 }, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products?client=abc-123');
  });

  test('productsApi.update with clientId PATCHes to ?client=<id>', async () => {
    await productsApi.update('prod-1', { name: 'Y' }, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products/prod-1?client=abc-123');
  });

  test('productsApi.remove with clientId DELETEs at ?client=<id>', async () => {
    await productsApi.remove('prod-1', { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products/prod-1?client=abc-123');
  });

  test('productsApi.bulk with clientId posts to /api/u-products-bulk?client=<id>', async () => {
    await productsApi.bulk({ action: 'set_status', ids: ['p1'], value: 'archived' } as any, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products-bulk?client=abc-123');
  });

  test('productsApi.exportUrl appends client= alongside other filter params', () => {
    const url = productsApi.exportUrl({ status: 'active' }, 'csv', { clientId: 'abc-123' });
    expect(url).toContain('client=abc-123');
    expect(url).toContain('format=csv');
    expect(url).toContain('status=active');
  });

  test('categoriesApi.list with clientId appends ?client=<id>', async () => {
    await categoriesApi.list({ clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-product-categories?client=abc-123');
  });

  test('categoriesApi.create with clientId POSTs to ?client=<id>', async () => {
    await categoriesApi.create('cat', { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-product-categories?client=abc-123');
  });

  test('categoriesApi.update with clientId PATCHes to ?client=<id>', async () => {
    await categoriesApi.update('cat-1', { name: 'Y' }, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-product-categories/cat-1?client=abc-123');
  });

  test('categoriesApi.remove with clientId DELETEs at ?client=<id>', async () => {
    await categoriesApi.remove('cat-1', { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-product-categories/cat-1?client=abc-123');
  });

  test('imagesApi.upload with clientId POSTs to ?client=<id>', async () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await imagesApi.upload('prod-1', file, undefined, { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products-image?client=abc-123');
  });

  test('imagesApi.remove with clientId DELETEs at ?client=<id>', async () => {
    await imagesApi.remove('img-1', { clientId: 'abc-123' });
    expect(capturedUrls[0]).toBe('/api/u-products-image/img-1?client=abc-123');
  });

  test('imagesApi.thumbUrl with clientId appends ?client=<id>', () => {
    const url = imagesApi.thumbUrl('img-1', { clientId: 'abc-123' });
    expect(url).toBe('/api/u-products-image-thumb/img-1?client=abc-123');
  });
});
