import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/workforce-employee-profile';
import { seedWorkforceClient } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedWorkforceClient>>;
beforeAll(async () => {
  ctx = await seedWorkforceClient();
});

function makeReq(method: string, url: string, cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;
  return new Request(url, { method, headers });
}

describe('workforce employee profile', () => {
  it('GET returns profile for valid resource_id', async () => {
    const req = makeReq(
      'GET',
      `http://localhost/api/workforce/employee-profile?resource_id=${ctx.resourceId}`,
      ctx.cookie,
    );
    const res = await handler(req);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      resource: { id: string; name: string };
      this_week: { shifts: number; punches: number; hours_worked: number; ot_hours: number; on_leave: boolean };
      leave: { pending: number; approved_this_month: number; balances: unknown[] };
      training: { completed: number; expiring_soon: number; expired: number };
      assets: { active_count: number; items: unknown[] };
    };
    expect(data.resource.id).toBe(ctx.resourceId);
    expect(typeof data.this_week.shifts).toBe('number');
    expect(typeof data.this_week.punches).toBe('number');
    expect(typeof data.this_week.hours_worked).toBe('number');
    expect(typeof data.this_week.ot_hours).toBe('number');
    expect(typeof data.this_week.on_leave).toBe('boolean');
    expect(Array.isArray(data.leave.balances)).toBe(true);
    expect(typeof data.leave.pending).toBe('number');
    expect(typeof data.leave.approved_this_month).toBe('number');
    expect(typeof data.training.completed).toBe('number');
    expect(typeof data.training.expiring_soon).toBe('number');
    expect(typeof data.training.expired).toBe('number');
    expect(typeof data.assets.active_count).toBe('number');
    expect(Array.isArray(data.assets.items)).toBe(true);
  });

  it('GET 404 for unknown resource_id', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const req = makeReq(
      'GET',
      `http://localhost/api/workforce/employee-profile?resource_id=${fakeId}`,
      ctx.cookie,
    );
    const res = await handler(req);
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe('resource_not_found');
  });

  it('GET 400 when resource_id missing', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/employee-profile', ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe('resource_id_required');
  });

  it('GET 400 when resource_id is not a UUID', async () => {
    const req = makeReq(
      'GET',
      'http://localhost/api/workforce/employee-profile?resource_id=not-a-uuid',
      ctx.cookie,
    );
    const res = await handler(req);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe('resource_id_invalid');
  });

  it('GET 401 without auth', async () => {
    const req = makeReq(
      'GET',
      `http://localhost/api/workforce/employee-profile?resource_id=${ctx.resourceId}`,
    );
    const res = await handler(req);
    expect(res.status).toBe(401);
  });

  it('POST returns 405', async () => {
    const req = makeReq(
      'POST',
      `http://localhost/api/workforce/employee-profile?resource_id=${ctx.resourceId}`,
      ctx.cookie,
    );
    const res = await handler(req);
    expect(res.status).toBe(405);
  });
});
