import { describe, it, expect, vi, beforeEach } from 'vitest';
import { posApi, PosApiError } from '../api';

describe('posApi', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('getMenu calls GET /api/pos/menu with credentials', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ products: [], categories: [] }), { status: 200 })
    );
    await posApi.getMenu();
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/pos/menu');
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe('include');
  });

  it('createSale POSTs JSON body, parses 201', async () => {
    const body = { channel: 'instore', idempotencyKey: 'k', customer: { name: 'A', phone: '1' }, lines: [] };
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 's1' }), { status: 201 })
    );
    const res = await posApi.createSale(body as any);
    expect(res.id).toBe('s1');
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string,string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify(body));
  });

  it('createSale throws PosApiError on 4xx with code+details', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'invalid_body', details: { foo: 'bar' } } }), { status: 400 })
    );
    try {
      await posApi.createSale({} as any);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PosApiError);
      expect((e as PosApiError).status).toBe(400);
      expect((e as PosApiError).code).toBe('invalid_body');
      expect((e as PosApiError).details).toEqual({ foo: 'bar' });
    }
  });

  it('PosApiError defaults code to "unknown" if body is malformed', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('not json', { status: 500 }));
    try {
      await posApi.getMenu();
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PosApiError);
      expect((e as PosApiError).status).toBe(500);
      expect((e as PosApiError).code).toBe('unknown');
    }
  });

  it('getSales appends query string when provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await posApi.getSales('status=paid&channel=instore');
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/pos/sales?status=paid&channel=instore');
  });

  it('getSales omits ? when query empty', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await posApi.getSales('');
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/pos/sales');
  });

  it('getSale builds /api/pos/sales/:id', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await posApi.getSale('abc-123');
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/pos/sales/abc-123');
  });

  it('transition POSTs to /sales/:id/state', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await posApi.transition('abc-123', { action: 'markPaid', paymentMethod: 'cash' });
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/pos/sales/abc-123/state');
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ action: 'markPaid', paymentMethod: 'cash' }));
  });
});
