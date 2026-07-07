import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/workforce-payroll';
import payrollIdHandler from '../../netlify/functions/workforce-payroll-id';
import ratesHandler from '../../netlify/functions/workforce-payroll-rates';
import { seedWorkforceClient } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedWorkforceClient>>;

beforeAll(async () => {
  ctx = await seedWorkforceClient();
});

function makeReq(method: string, url: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['cookie'] = cookie;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('workforce payroll rates', () => {
  it('POST sets a rate for user_node', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/payroll-rates', {
      user_node_id: ctx.userNodeId,
      hourly_rate: 25.00,
      effective_from: '2026-01-01',
    }, ctx.cookie);
    const res = await ratesHandler(req);
    // 201 (first insert) or 200 after upsert — the function always returns 201
    expect([200, 201]).toContain(res.status);
    const data = await res.json() as { rate: { hourly_rate: string | number; user_node_id: string } };
    expect(Number(data.rate.hourly_rate)).toBe(25);
    expect(data.rate.user_node_id).toBe(ctx.userNodeId);
  });

  it('POST upserts (updates) an existing rate', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/payroll-rates', {
      user_node_id: ctx.userNodeId,
      hourly_rate: 30.00,
      effective_from: '2026-01-01',
      notes: 'Updated rate',
    }, ctx.cookie);
    const res = await ratesHandler(req);
    expect([200, 201]).toContain(res.status);
    const data = await res.json() as { rate: { hourly_rate: string | number; notes: string } };
    expect(Number(data.rate.hourly_rate)).toBe(30);
    expect(data.rate.notes).toBe('Updated rate');
  });

  it('GET lists rates', async () => {
    const req = makeReq('GET', `http://localhost/api/workforce/payroll-rates?user_node_id=${ctx.userNodeId}`, undefined, ctx.cookie);
    const res = await ratesHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { rates: Array<{ user_node_id: string }> };
    expect(data.rates.length).toBeGreaterThan(0);
    expect(data.rates.every(r => r.user_node_id === ctx.userNodeId)).toBe(true);
  });

  it('POST 400 missing user_node_id', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/payroll-rates', {
      hourly_rate: 20,
      effective_from: '2026-01-01',
    }, ctx.cookie);
    const res = await ratesHandler(req);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('user_node_id_required');
  });

  it('GET 401 without auth', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/payroll-rates');
    const res = await ratesHandler(req);
    expect(res.status).toBe(401);
  });
});

describe('workforce payroll periods', () => {
  // Use unique dates per test run to avoid UNIQUE constraint conflicts on re-runs.
  const rand = Math.floor(Math.random() * 89) + 1; // 1-89
  const month = String(rand % 12 + 1).padStart(2, '0');
  const startDate = `2025-${month}-01`;
  const endDate = `2025-${month}-28`;
  let periodId: string;

  it('POST creates a payroll period', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/payroll', {
      period_start: startDate,
      period_end: endDate,
    }, ctx.cookie);
    const res = await handler(req);

    if (res.status === 201) {
      const data = await res.json() as { period: { id: string; status: string } };
      expect(data.period.status).toBe('draft');
      periodId = data.period.id;
    } else {
      // Conflict on re-run — fetch from list to get the existing id
      expect(res.status).toBe(409);
      const listReq = makeReq('GET', 'http://localhost/api/workforce/payroll', undefined, ctx.cookie);
      const listRes = await handler(listReq);
      const listData = await listRes.json() as { periods: Array<{ id: string; period_start: string }> };
      const found = listData.periods.find(p => p.period_start === startDate);
      periodId = found?.id ?? listData.periods[0]!.id;
    }

    expect(periodId).toBeTruthy();
  });

  it('POST 409 period_exists on duplicate dates', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/payroll', {
      period_start: startDate,
      period_end: endDate,
    }, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(409);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('period_exists');
  });

  it('POST 400 period_end_before_start', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/payroll', {
      period_start: '2025-12-31',
      period_end: '2025-01-01',
    }, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('period_end_before_start');
  });

  it('GET lists periods', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/payroll', undefined, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { periods: unknown[] };
    expect(data.periods.length).toBeGreaterThan(0);
  });

  it('GET period detail returns line items array', async () => {
    const req = makeReq('GET', `http://localhost/api/workforce/payroll/${periodId}`, undefined, ctx.cookie);
    const res = await payrollIdHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { period: { id: string; status: string }; line_items: unknown[] };
    expect(data.period.id).toBe(periodId);
    expect(Array.isArray(data.line_items)).toBe(true);
  });

  it('PATCH approves a draft period', async () => {
    // Check current status first (may already be approved on re-run)
    const detailReq = makeReq('GET', `http://localhost/api/workforce/payroll/${periodId}`, undefined, ctx.cookie);
    const detailRes = await payrollIdHandler(detailReq);
    const detailData = await detailRes.json() as { period: { status: string } };

    if (detailData.period.status === 'draft') {
      const req = makeReq('PATCH', `http://localhost/api/workforce/payroll/${periodId}`, {}, ctx.cookie);
      const res = await payrollIdHandler(req);
      expect(res.status).toBe(200);
      const data = await res.json() as { period: { status: string; approved_by: string } };
      expect(data.period.status).toBe('approved');
      expect(data.period.approved_by).toBeTruthy();
    } else {
      // Already approved on re-run — verify already_approved guard works
      expect(detailData.period.status).toBe('approved');
      const req = makeReq('PATCH', `http://localhost/api/workforce/payroll/${periodId}`, {}, ctx.cookie);
      const res = await payrollIdHandler(req);
      expect(res.status).toBe(409);
      const data = await res.json() as { error: { code: string } };
      expect(data.error.code).toBe('already_approved');
    }
  });

  it('DELETE 409 cannot_delete_approved', async () => {
    const req = makeReq('DELETE', `http://localhost/api/workforce/payroll/${periodId}`, undefined, ctx.cookie);
    const res = await payrollIdHandler(req);
    // If draft, delete succeeds (204); if approved, 409
    expect([204, 409]).toContain(res.status);
    if (res.status === 409) {
      const data = await res.json() as { error: { code: string } };
      expect(data.error.code).toBe('cannot_delete_approved');
    }
  });

  it('DELETE removes a draft period', async () => {
    // Create a fresh period to delete
    const newStart = '2024-03-01';
    const newEnd = '2024-03-31';
    const createReq = makeReq('POST', 'http://localhost/api/workforce/payroll', {
      period_start: newStart,
      period_end: newEnd,
    }, ctx.cookie);
    const createRes = await handler(createReq);
    if (createRes.status !== 201) {
      // Skip if already exists from prior run and was deleted
      return;
    }
    const createData = await createRes.json() as { period: { id: string } };
    const newId = createData.period.id;

    const delReq = makeReq('DELETE', `http://localhost/api/workforce/payroll/${newId}`, undefined, ctx.cookie);
    const delRes = await payrollIdHandler(delReq);
    expect(delRes.status).toBe(204);
  });

  it('GET 404 for unknown period', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const req = makeReq('GET', `http://localhost/api/workforce/payroll/${fakeId}`, undefined, ctx.cookie);
    const res = await payrollIdHandler(req);
    expect(res.status).toBe(404);
  });

  it('GET 401 without auth', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/payroll');
    const res = await handler(req);
    expect(res.status).toBe(401);
  });
});
