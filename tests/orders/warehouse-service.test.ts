import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWarehouseEvidence, requestWarehouseTask } from '../../netlify/functions/_orders-warehouse-service';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Orders Warehouse service client', () => {
  it('uses only the server token and never forwards a browser credential', async () => {
    vi.stubEnv('ORDERS_WAREHOUSE_SERVICE_TOKEN', 'server-only-token');
    let init: RequestInit | undefined;
    vi.stubGlobal('fetch', async (_url: string, options?: RequestInit) => {
      init = options;
      return new Response(JSON.stringify({ task: { id: 'task-1' }, replayed: false }), { status: 201 });
    });
    const result = await requestWarehouseTask(new Request('https://example.test/api/orders/warehouse-execution-tasks', { headers: { cookie: 'bu_session=browser' } }), { client_id: 'client', kind: 'pick', idempotency_key: 'key', fulfillment_line_id: 'line' });
    expect(result).toMatchObject({ ok: true, value: { task: { id: 'task-1' } } });
    expect(init?.headers).toMatchObject({ 'x-exsol-orders-warehouse-token': 'server-only-token' });
    expect(init?.headers).not.toHaveProperty('cookie');
  });

  it('does not call Warehouse when the server token is missing', async () => {
    vi.stubEnv('ORDERS_WAREHOUSE_SERVICE_TOKEN', '');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(readWarehouseEvidence(new Request('https://example.test/api/orders/warehouse-execution-tasks'), 'client', { fulfillment_line_id: 'line' })).resolves.toMatchObject({ ok: false, code: 'warehouse_service_unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
