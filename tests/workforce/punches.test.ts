import { describe, it, expect, beforeAll } from 'vitest';
import { neon } from '@neondatabase/serverless';
import handler from '../../netlify/functions/workforce-punches';
import punchHandler from '../../netlify/functions/workforce-punch';
import { seedWorkforceClient } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedWorkforceClient>>;
const sql = neon(process.env.DATABASE_URL!);

beforeAll(async () => { ctx = await seedWorkforceClient(); });

function makeReq(method: string, url: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['cookie'] = cookie;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('workforce punches', () => {
  let openPunchId: string;

  it('POST clock in creates punch record', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/punches', {
      resource_id: ctx.resourceId,
      notes: 'Test clock-in',
    }, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(201);
    const data = await res.json() as { punch: { id: string; punched_out_at: null } };
    expect(data.punch.punched_out_at).toBeNull();
    openPunchId = data.punch.id;
  });

  it('POST 409 on double clock-in same resource', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/punches', {
      resource_id: ctx.resourceId,
    }, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(409);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('already_clocked_in');
  });

  it('GET lists punches for resource', async () => {
    const req = makeReq('GET', `http://localhost/api/workforce/punches?resource_id=${ctx.resourceId}`, undefined, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { punches: unknown[] };
    expect(data.punches.length).toBeGreaterThan(0);
  });

  it('GET filters punch dates in the workspace timezone', async () => {
    await sql`UPDATE public.clients SET timezone = 'Asia/Kolkata' WHERE id = ${ctx.clientId}::uuid`;
    const rows = await sql`
      INSERT INTO public.workforce_punches (client_id, resource_id, punched_in_at, punched_out_at)
      VALUES (
        ${ctx.clientId}::uuid,
        ${ctx.resourceId}::uuid,
        '2026-07-20T19:30:00.000Z'::timestamptz,
        '2026-07-20T20:30:00.000Z'::timestamptz
      )
      RETURNING id
    ` as Array<{ id: string }>;
    const punchId = rows[0]!.id;

    const localDay = await handler(makeReq(
      'GET',
      `http://localhost/api/workforce/punches?resource_id=${ctx.resourceId}&from=2026-07-21&to=2026-07-21`,
      undefined,
      ctx.cookie,
    ));
    const localDayBody = await localDay.json() as { punches: Array<{ id: string }> };
    expect(localDayBody.punches.map(punch => punch.id)).toContain(punchId);

    const utcDay = await handler(makeReq(
      'GET',
      `http://localhost/api/workforce/punches?resource_id=${ctx.resourceId}&from=2026-07-20&to=2026-07-20`,
      undefined,
      ctx.cookie,
    ));
    const utcDayBody = await utcDay.json() as { punches: Array<{ id: string }> };
    expect(utcDayBody.punches.map(punch => punch.id)).not.toContain(punchId);
  });

  it('PATCH clock out sets punched_out_at', async () => {
    const req = makeReq('PATCH', `http://localhost/api/workforce/punch/${openPunchId}`, {}, ctx.cookie);
    const res = await punchHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { punch: { punched_out_at: string | null } };
    expect(data.punch.punched_out_at).not.toBeNull();
  });

  it('PATCH 409 on double clock-out', async () => {
    const req = makeReq('PATCH', `http://localhost/api/workforce/punch/${openPunchId}`, {}, ctx.cookie);
    const res = await punchHandler(req);
    expect(res.status).toBe(409);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('already_clocked_out');
  });

  it('GET 401 without auth', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/punches');
    const res = await handler(req);
    expect(res.status).toBe(401);
  });
});
