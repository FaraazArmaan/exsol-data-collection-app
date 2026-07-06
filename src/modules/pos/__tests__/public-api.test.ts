// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publicApi, PosApiError } from '../shared/api';

beforeEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('publicApi', () => {
  it('getMenu hits /api/public/menu/:slug', async () => {
    const f = mockFetch(200, { tenant: { name: 'Shop' }, categories: [], products: [] });
    const r = await publicApi.getMenu('my-shop');
    expect(f.mock.calls[0]![0]).toBe('/api/public/menu/my-shop');
    expect(r.tenant.name).toBe('Shop');
  });

  it('createSale POSTs to /api/public/sales with the body', async () => {
    const f = mockFetch(201, { id: 's1', status: 'pending_payment' });
    const body = { slug: 'my-shop', channel: 'pickup' as const, idempotencyKey: 'k'.repeat(10), honeypot: '', customer: { name: 'A', phone: '1' }, lines: [{ productId: 'p1', qty: 1 }] };
    const r = await publicApi.createSale(body);
    expect(f.mock.calls[0]![0]).toBe('/api/public/sales');
    expect((f.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    expect((r as { id: string }).id).toBe('s1');
  });

  it('getSale hits /api/public/sales/:uuid', async () => {
    const f = mockFetch(200, { id: 's1', status: 'paid' });
    await publicApi.getSale('s1');
    expect(f.mock.calls[0]![0]).toBe('/api/public/sales/s1');
  });

  it('throws PosApiError on non-2xx', async () => {
    mockFetch(404, { error: { code: 'storefront_unavailable' } });
    await expect(publicApi.getMenu('nope')).rejects.toBeInstanceOf(PosApiError);
  });
});
