import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/workforce-overtime';
import otHandler from '../../netlify/functions/workforce-overtime-id';
import { seedWorkforceClient } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedWorkforceClient>>;
beforeAll(async () => { ctx = await seedWorkforceClient(); });

function makeReq(method: string, url: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['cookie'] = cookie;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('workforce overtime', () => {
  let createdId: string;

  it('POST logs OT entry', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/overtime', {
      resource_id: ctx.resourceId,
      ot_date: '2026-08-01',
      ot_hours: 2.5,
      reason: 'Project deadline',
    }, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(201);
    const data = await res.json() as { entry: { id: string; status: string; ot_hours: number } };
    expect(data.entry.status).toBe('pending');
    expect(Number(data.entry.ot_hours)).toBe(2.5);
    createdId = data.entry.id;
  });

  it('GET lists entries', async () => {
    const req = makeReq('GET', `http://localhost/api/workforce/overtime?resource_id=${ctx.resourceId}`, undefined, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { entries: unknown[] };
    expect(data.entries.length).toBeGreaterThan(0);
  });

  it('GET filters by status', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/overtime?status=pending', undefined, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { entries: Array<{ status: string }> };
    expect(data.entries.every(e => e.status === 'pending')).toBe(true);
  });

  it('PATCH approve changes status', async () => {
    const req = makeReq('PATCH', `http://localhost/api/workforce/overtime/${createdId}`, { action: 'approve' }, ctx.cookie);
    const res = await otHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { entry: { status: string; handled_by: string } };
    expect(data.entry.status).toBe('approved');
    expect(data.entry.handled_by).toBeTruthy();
  });

  it('PATCH 409 already_handled on re-approve', async () => {
    const req = makeReq('PATCH', `http://localhost/api/workforce/overtime/${createdId}`, { action: 'approve' }, ctx.cookie);
    const res = await otHandler(req);
    expect(res.status).toBe(409);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('already_handled');
  });

  it('POST creates another entry and deny it', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/overtime', {
      resource_id: ctx.resourceId,
      ot_date: '2026-08-02',
      ot_hours: 1,
    }, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(201);
    const data = await res.json() as { entry: { id: string } };
    const denyReq = makeReq('PATCH', `http://localhost/api/workforce/overtime/${data.entry.id}`, { action: 'deny' }, ctx.cookie);
    const denyRes = await otHandler(denyReq);
    expect(denyRes.status).toBe(200);
    const denyData = await denyRes.json() as { entry: { status: string } };
    expect(denyData.entry.status).toBe('denied');
  });

  it('GET 401 without auth', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/overtime');
    const res = await handler(req);
    expect(res.status).toBe(401);
  });
});
