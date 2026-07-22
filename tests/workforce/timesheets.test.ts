import { describe, it, expect } from 'vitest';
import timesheetsHandler from '../../netlify/functions/workforce-timesheets';
import timesheetHandler from '../../netlify/functions/workforce-timesheet';
import {
  seedWorkforceClient,
  makeBucketUserRequest,
  seedTimesheetEntry,
} from './_helpers';

type Ctx = Awaited<ReturnType<typeof seedWorkforceClient>>;

const list = (ctx: Ctx, params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return timesheetsHandler(
    makeBucketUserRequest(ctx, 'GET', `/api/workforce/timesheets${qs}`),
  );
};

const create = (ctx: Ctx, body: unknown) =>
  timesheetsHandler(makeBucketUserRequest(ctx, 'POST', '/api/workforce/timesheets', body));

const patch = (ctx: Ctx, id: string, body: unknown) =>
  timesheetHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/workforce/timesheet/${id}`, body));

const del = (ctx: Ctx, id: string) =>
  timesheetHandler(makeBucketUserRequest(ctx, 'DELETE', `/api/workforce/timesheet/${id}`));

describe('workforce timesheets', () => {
  it('creates an entry and lists it (GET with resource_id filter)', async () => {
    const ctx = await seedWorkforceClient();
    const res = await create(ctx, {
      resource_id: ctx.resourceId,
      entry_date: '2026-02-10',
      start_time: '08:00',
      end_time: '16:00',
      notes: 'first entry',
    });
    expect(res.status).toBe(201);
    const entry = (await res.json()).entry as Record<string, unknown>;
    expect(entry.resource_id).toBe(ctx.resourceId);
    expect(entry.entry_date).toBe('2026-02-10');
    expect(entry.start_time).toBe('08:00');
    expect(entry.end_time).toBe('16:00');
    expect(entry.notes).toBe('first entry');

    // List filtered by resource_id.
    const listRes = await list(ctx, { resource_id: ctx.resourceId });
    expect(listRes.status).toBe(200);
    const entries = (await listRes.json()).entries as Array<{ id: unknown }>;
    expect(entries.map((e) => e.id)).toContain(entry.id);
  });

  it('lists entries in a date range', async () => {
    const ctx = await seedWorkforceClient();
    const idMar = await seedTimesheetEntry(ctx, ctx.resourceId, { entryDate: '2026-03-05' });
    const idMay = await seedTimesheetEntry(ctx, ctx.resourceId, { entryDate: '2026-05-20' });

    // Only March entry should appear in March–April range.
    const res = await list(ctx, { from: '2026-03-01', to: '2026-04-30' });
    expect(res.status).toBe(200);
    const ids = (await res.json()).entries.map((e: { id: string }) => e.id);
    expect(ids).toContain(idMar);
    expect(ids).not.toContain(idMay);
  });

  it('400 resource_id_required when resource_id is missing', async () => {
    const ctx = await seedWorkforceClient();
    const res = await create(ctx, {
      entry_date: '2026-02-10',
      start_time: '09:00',
      end_time: '17:00',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('resource_id_required');
  });

  it('400 entry_date_required when entry_date is missing', async () => {
    const ctx = await seedWorkforceClient();
    const res = await create(ctx, {
      resource_id: ctx.resourceId,
      start_time: '09:00',
      end_time: '17:00',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('entry_date_required');
  });

  it('400 start_time_required when start_time is missing', async () => {
    const ctx = await seedWorkforceClient();
    const res = await create(ctx, {
      resource_id: ctx.resourceId,
      entry_date: '2026-02-10',
      end_time: '17:00',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('start_time_required');
  });

  it('400 end_time_required when end_time is missing', async () => {
    const ctx = await seedWorkforceClient();
    const res = await create(ctx, {
      resource_id: ctx.resourceId,
      entry_date: '2026-02-10',
      start_time: '09:00',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('end_time_required');
  });

  it('404 resource_not_found when resource belongs to another client', async () => {
    const ctx = await seedWorkforceClient();
    const other = await seedWorkforceClient();
    // Use the other client's resource in ctx's POST request.
    const res = await create(ctx, {
      resource_id: other.resourceId,
      entry_date: '2026-02-10',
      start_time: '09:00',
      end_time: '17:00',
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('resource_not_found');
  });

  it('PATCH updates start_time, end_time and notes', async () => {
    const ctx = await seedWorkforceClient();
    const id = await seedTimesheetEntry(ctx, ctx.resourceId, {
      entryDate: '2026-06-01',
      startTime: '09:00',
      endTime: '17:00',
    });

    const res = await patch(ctx, id, {
      start_time: '10:00',
      end_time: '18:00',
      notes: 'updated notes',
    });
    expect(res.status).toBe(200);
    const entry = (await res.json()).entry as Record<string, unknown>;
    expect(entry.start_time).toBe('10:00');
    expect(entry.end_time).toBe('18:00');
    expect(entry.notes).toBe('updated notes');
  });

  it('PATCH approve sets approved_by and approved_at', async () => {
    const ctx = await seedWorkforceClient();
    const id = await seedTimesheetEntry(ctx, ctx.resourceId, {
      entryDate: '2026-06-02',
      userNodeId: ctx.userNodeId,
    });

    const res = await patch(ctx, id, { approve: true });
    expect(res.status).toBe(200);
    const entry = (await res.json()).entry as Record<string, unknown>;
    expect(entry.approved_by).toBe(ctx.userNodeId);
    expect(entry.approved_at).not.toBeNull();
  });

  it('DELETE removes an unapproved entry (204)', async () => {
    const ctx = await seedWorkforceClient();
    const id = await seedTimesheetEntry(ctx, ctx.resourceId, { entryDate: '2026-06-03' });

    const res = await del(ctx, id);
    expect(res.status).toBe(204);

    // Confirm it is gone.
    const listRes = await list(ctx);
    const ids = (await listRes.json()).entries.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(id);
  });

  it('409 already_approved on DELETE of an approved entry', async () => {
    const ctx = await seedWorkforceClient();
    const id = await seedTimesheetEntry(ctx, ctx.resourceId, {
      entryDate: '2026-06-04',
      approvedBy: ctx.userNodeId,
    });

    const res = await del(ctx, id);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('already_approved');
  });

  it('404 on PATCH of an entry belonging to another client', async () => {
    const ctx = await seedWorkforceClient();
    const other = await seedWorkforceClient();
    const foreignId = await seedTimesheetEntry(other, other.resourceId, { entryDate: '2026-06-05' });

    const res = await patch(ctx, foreignId, { notes: 'hacked' });
    expect(res.status).toBe(404);
  });

  it('404 on DELETE of an entry belonging to another client', async () => {
    const ctx = await seedWorkforceClient();
    const other = await seedWorkforceClient();
    const foreignId = await seedTimesheetEntry(other, other.resourceId, { entryDate: '2026-06-06' });

    const res = await del(ctx, foreignId);
    expect(res.status).toBe(404);
  });

  it('401 without auth on GET', async () => {
    const res = await timesheetsHandler(
      new Request('http://localhost/api/workforce/timesheets', { method: 'GET' }),
    );
    expect(res.status).toBe(401);
  });

  it('401 without auth on POST', async () => {
    const res = await timesheetsHandler(
      new Request('http://localhost/api/workforce/timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource_id: 'x', entry_date: '2026-01-01', start_time: '09:00', end_time: '17:00' }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
