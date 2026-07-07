import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/workforce-leaves';
import leaveHandler from '../../netlify/functions/workforce-leave';
import { seedWorkforceClient, makeBucketUserRequest } from './_helpers';

type Ctx = Awaited<ReturnType<typeof seedWorkforceClient>>;

let ctx: Ctx;

beforeAll(async () => {
  ctx = await seedWorkforceClient();
});

const listReq = (c: Ctx, params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return handler(makeBucketUserRequest(c, 'GET', `/api/workforce/leaves${qs}`));
};

const createReq = (c: Ctx, body: unknown) =>
  handler(makeBucketUserRequest(c, 'POST', '/api/workforce/leaves', body));

const patchReq = (c: Ctx, id: string, body: unknown) =>
  leaveHandler(makeBucketUserRequest(c, 'PATCH', `/api/workforce/leave/${id}`, body));

const deleteReq = (c: Ctx, id: string) =>
  leaveHandler(makeBucketUserRequest(c, 'DELETE', `/api/workforce/leave/${id}`));

describe('workforce leaves', () => {
  let createdId: string;

  it('POST creates a pending leave request', async () => {
    const res = await createReq(ctx, {
      resource_id: ctx.resourceId,
      leave_type: 'annual',
      start_date: '2026-10-01',
      end_date: '2026-10-03',
      notes: 'Test leave',
    });
    expect(res.status).toBe(201);
    const data = await res.json() as { request: { id: string; status: string } };
    expect(data.request.status).toBe('pending');
    createdId = data.request.id;
  });

  it('GET lists requests for the resource', async () => {
    const res = await listReq(ctx, { resource_id: ctx.resourceId });
    expect(res.status).toBe(200);
    const data = await res.json() as { requests: unknown[] };
    expect(Array.isArray(data.requests)).toBe(true);
    expect(data.requests.length).toBeGreaterThan(0);
  });

  it('GET filters by status=pending', async () => {
    const res = await listReq(ctx, { status: 'pending' });
    expect(res.status).toBe(200);
    const data = await res.json() as { requests: Array<{ status: string }> };
    expect(data.requests.every(r => r.status === 'pending')).toBe(true);
  });

  it('PATCH approve → status=approved', async () => {
    const res = await patchReq(ctx, createdId, { action: 'approve' });
    expect(res.status).toBe(200);
    const data = await res.json() as { request: { status: string; handled_by: string } };
    expect(data.request.status).toBe('approved');
    expect(data.request.handled_by).toBeTruthy();
  });

  it('PATCH 409 already_handled on re-approve', async () => {
    const res = await patchReq(ctx, createdId, { action: 'approve' });
    expect(res.status).toBe(409);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('already_handled');
  });

  it('POST + deny: creates a second request and denies it', async () => {
    const createRes = await createReq(ctx, {
      resource_id: ctx.resourceId,
      leave_type: 'sick',
      start_date: '2026-11-01',
      end_date: '2026-11-02',
    });
    expect(createRes.status).toBe(201);
    const { request } = await createRes.json() as { request: { id: string } };

    const denyRes = await patchReq(ctx, request.id, { action: 'deny' });
    expect(denyRes.status).toBe(200);
    const denyData = await denyRes.json() as { request: { status: string } };
    expect(denyData.request.status).toBe('denied');
  });

  it('POST + DELETE: creates a third request (pending) and deletes it', async () => {
    const createRes = await createReq(ctx, {
      resource_id: ctx.resourceId,
      leave_type: 'personal',
      start_date: '2026-12-01',
      end_date: '2026-12-01',
    });
    expect(createRes.status).toBe(201);
    const { request } = await createRes.json() as { request: { id: string } };

    const delRes = await deleteReq(ctx, request.id);
    expect(delRes.status).toBe(204);
  });

  it('DELETE 409 cannot_delete_handled on approved request', async () => {
    const delRes = await deleteReq(ctx, createdId);
    expect(delRes.status).toBe(409);
    const data = await delRes.json() as { error: { code: string } };
    expect(data.error.code).toBe('cannot_delete_handled');
  });

  it('POST 400 on missing resource_id', async () => {
    const res = await createReq(ctx, {
      leave_type: 'annual',
      start_date: '2027-01-01',
      end_date: '2027-01-02',
    });
    expect(res.status).toBe(400);
  });

  it('POST 400 on invalid leave_type', async () => {
    const res = await createReq(ctx, {
      resource_id: ctx.resourceId,
      leave_type: 'vacation',
      start_date: '2027-01-01',
      end_date: '2027-01-02',
    });
    expect(res.status).toBe(400);
  });

  it('GET 401 without auth', async () => {
    const res = await handler(
      new Request('http://localhost/api/workforce/leaves', { method: 'GET' }),
    );
    expect(res.status).toBe(401);
  });
});
