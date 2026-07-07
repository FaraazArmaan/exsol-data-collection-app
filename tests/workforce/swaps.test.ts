import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/workforce-swaps';
import swapHandler from '../../netlify/functions/workforce-swap';
import { seedWorkforceClient, seedShift } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedWorkforceClient>>;
let shiftId: string;

beforeAll(async () => {
  ctx = await seedWorkforceClient();
  shiftId = await seedShift(ctx, ctx.resourceId, 1, '09:00', '17:00');
});

function makeReq(method: string, url: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['cookie'] = cookie;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('workforce swap board', () => {
  let swapId: string;

  it('POST offers a swap', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/swaps', {
      shift_id: shiftId,
      offering_date: '2026-09-01',
      notes: 'Offering Monday shift',
    }, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(201);
    const data = await res.json() as { swap: { id: string; status: string } };
    expect(data.swap.status).toBe('open');
    swapId = data.swap.id;
  });

  it('GET lists open swaps', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/swaps?status=open', undefined, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { swaps: Array<{ status: string }> };
    expect(data.swaps.every(s => s.status === 'open')).toBe(true);
  });

  it('GET lists all swaps without filter', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/swaps', undefined, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { swaps: unknown[] };
    expect(data.swaps.length).toBeGreaterThan(0);
  });

  it('PATCH claim changes status to claimed', async () => {
    const req = makeReq('PATCH', `http://localhost/api/workforce/swap/${swapId}`, {
      action: 'claim',
      resource_id: ctx.resourceId,
    }, ctx.cookie);
    const res = await swapHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { swap: { status: string; claimed_by_resource_id: string } };
    expect(data.swap.status).toBe('claimed');
    expect(data.swap.claimed_by_resource_id).toBeTruthy();
  });

  it('PATCH claim 409 not_open on already-claimed swap', async () => {
    const req = makeReq('PATCH', `http://localhost/api/workforce/swap/${swapId}`, {
      action: 'claim',
      resource_id: ctx.resourceId,
    }, ctx.cookie);
    const res = await swapHandler(req);
    expect(res.status).toBe(409);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('not_open');
  });

  it('PATCH approve changes status to approved', async () => {
    const req = makeReq('PATCH', `http://localhost/api/workforce/swap/${swapId}`, {
      action: 'approve',
    }, ctx.cookie);
    const res = await swapHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { swap: { status: string; handled_by: string } };
    expect(data.swap.status).toBe('approved');
    expect(data.swap.handled_by).toBeTruthy();
  });

  it('DELETE 409 cannot_delete_approved', async () => {
    const req = makeReq('DELETE', `http://localhost/api/workforce/swap/${swapId}`, undefined, ctx.cookie);
    const res = await swapHandler(req);
    expect(res.status).toBe(409);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('cannot_delete_approved');
  });

  it('POST + claim + deny flow', async () => {
    const offerReq = makeReq('POST', 'http://localhost/api/workforce/swaps', {
      shift_id: shiftId,
      offering_date: '2026-09-08',
    }, ctx.cookie);
    const offerRes = await handler(offerReq);
    expect(offerRes.status).toBe(201);
    const { swap: swap2 } = await offerRes.json() as { swap: { id: string } };

    const claimReq = makeReq('PATCH', `http://localhost/api/workforce/swap/${swap2.id}`, {
      action: 'claim',
      resource_id: ctx.resourceId,
    }, ctx.cookie);
    expect((await swapHandler(claimReq)).status).toBe(200);

    const denyReq = makeReq('PATCH', `http://localhost/api/workforce/swap/${swap2.id}`, {
      action: 'deny',
    }, ctx.cookie);
    const denyRes = await swapHandler(denyReq);
    expect(denyRes.status).toBe(200);
    const denyData = await denyRes.json() as { swap: { status: string } };
    expect(denyData.swap.status).toBe('denied');
  });

  it('POST + cancel flow', async () => {
    const offerReq = makeReq('POST', 'http://localhost/api/workforce/swaps', {
      shift_id: shiftId,
      offering_date: '2026-09-15',
    }, ctx.cookie);
    const offerRes = await handler(offerReq);
    expect(offerRes.status).toBe(201);
    const { swap: swap3 } = await offerRes.json() as { swap: { id: string } };

    const cancelReq = makeReq('PATCH', `http://localhost/api/workforce/swap/${swap3.id}`, {
      action: 'cancel',
    }, ctx.cookie);
    const cancelRes = await swapHandler(cancelReq);
    expect(cancelRes.status).toBe(200);
    const cancelData = await cancelRes.json() as { swap: { status: string } };
    expect(cancelData.swap.status).toBe('cancelled');
  });

  it('PATCH 409 cannot_cancel on cancelled swap', async () => {
    const offerReq = makeReq('POST', 'http://localhost/api/workforce/swaps', {
      shift_id: shiftId,
      offering_date: '2026-09-22',
    }, ctx.cookie);
    const offerRes = await handler(offerReq);
    const { swap: swap4 } = await offerRes.json() as { swap: { id: string } };

    // cancel it
    await swapHandler(makeReq('PATCH', `http://localhost/api/workforce/swap/${swap4.id}`, { action: 'cancel' }, ctx.cookie));

    // try to cancel again
    const res = await swapHandler(makeReq('PATCH', `http://localhost/api/workforce/swap/${swap4.id}`, { action: 'cancel' }, ctx.cookie));
    expect(res.status).toBe(409);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('cannot_cancel');
  });

  it('POST 400 missing shift_id', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/swaps', {
      offering_date: '2026-09-01',
    }, ctx.cookie);
    const res = await handler(req);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('shift_id_required');
  });

  it('GET 401 without auth', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/swaps');
    const res = await handler(req);
    expect(res.status).toBe(401);
  });

  it('PATCH 400 resource_id_required on claim without resource', async () => {
    const offerReq = makeReq('POST', 'http://localhost/api/workforce/swaps', {
      shift_id: shiftId,
      offering_date: '2026-09-29',
    }, ctx.cookie);
    const offerRes = await handler(offerReq);
    const { swap: swap5 } = await offerRes.json() as { swap: { id: string } };

    const claimReq = makeReq('PATCH', `http://localhost/api/workforce/swap/${swap5.id}`, {
      action: 'claim',
    }, ctx.cookie);
    const res = await swapHandler(claimReq);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('resource_id_required');
  });
});
