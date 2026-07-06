import { describe, it, expect } from 'vitest';
import shiftsHandler from '../../netlify/functions/workforce-shifts';
import shiftHandler from '../../netlify/functions/workforce-shift';
import { seedWorkforceClient, makeBucketUserRequest, seedShift, randName } from './_helpers';

const list = (ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, qs = '') =>
  shiftsHandler(makeBucketUserRequest(ctx, 'GET', `/api/workforce/shifts${qs}`));

const create = (ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, body: unknown) =>
  shiftsHandler(makeBucketUserRequest(ctx, 'POST', '/api/workforce/shifts', body));

const del = (ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, id: string) =>
  shiftHandler(makeBucketUserRequest(ctx, 'DELETE', `/api/workforce/shift/${id}`));

describe('workforce shifts', () => {
  it('creates a shift and lists it', async () => {
    const ctx = await seedWorkforceClient();
    const res = await create(ctx, {
      resource_id: ctx.resourceId,
      weekday: 1,
      start_time: '09:00',
      end_time: '17:00',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { shift: { id: string; weekday: number } };
    expect(body.shift.weekday).toBe(1);

    const listed = await (await list(ctx, `?resource_id=${ctx.resourceId}`)).json() as { shifts: Array<{ id: string }> };
    expect(listed.shifts.map((s) => s.id)).toContain(body.shift.id);
  });

  it('lists all shifts when no resource_id filter', async () => {
    const ctx = await seedWorkforceClient();
    await seedShift(ctx, ctx.resourceId, 2);
    const res = await list(ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { shifts: unknown[] };
    expect(body.shifts.length).toBeGreaterThan(0);
  });

  it('400 when resource_id missing', async () => {
    const ctx = await seedWorkforceClient();
    const res = await create(ctx, { weekday: 1, start_time: '09:00', end_time: '17:00' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('resource_id_required');
  });

  it('400 when weekday invalid', async () => {
    const ctx = await seedWorkforceClient();
    const res = await create(ctx, { resource_id: ctx.resourceId, weekday: 9, start_time: '09:00', end_time: '17:00' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('weekday_invalid');
  });

  it('404 when resource belongs to another client', async () => {
    const ctx = await seedWorkforceClient();
    const other = await seedWorkforceClient();
    const res = await create(ctx, {
      resource_id: other.resourceId,
      weekday: 1,
      start_time: '10:00',
      end_time: '14:00',
    });
    expect(res.status).toBe(404);
  });

  it('deletes a shift', async () => {
    const ctx = await seedWorkforceClient();
    const id = await seedShift(ctx, ctx.resourceId, 3);
    const res = await del(ctx, id);
    expect(res.status).toBe(204);
  });

  it('404 on deleting a foreign-client shift', async () => {
    const ctx = await seedWorkforceClient();
    const other = await seedWorkforceClient();
    const id = await seedShift(other, other.resourceId);
    const res = await del(ctx, id);
    expect(res.status).toBe(404);
  });

  it('401 without auth', async () => {
    const res = await shiftsHandler(new Request('http://localhost/api/workforce/shifts'));
    expect(res.status).toBe(401);
  });
});
