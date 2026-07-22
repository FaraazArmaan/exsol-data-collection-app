import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import payrollHandler from '../../netlify/functions/workforce-payroll';
import payrollDetailHandler from '../../netlify/functions/workforce-payroll-id';
import timesheetsHandler from '../../netlify/functions/workforce-timesheets';
import timesheetHandler from '../../netlify/functions/workforce-timesheet';
import ledgerHandler from '../../netlify/functions/workforce-time-ledger';
import correctionHandler from '../../netlify/functions/workforce-time-correction';
import { makeBucketUserRequest, seedWorkforceClient } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

function req(ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, method: string, path: string, body?: unknown) {
  return makeBucketUserRequest(ctx, method, path, body);
}

async function setRate(ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, rate = 40) {
  await sql`
    INSERT INTO public.payroll_rates (client_id, user_node_id, hourly_rate, effective_from)
    VALUES (${ctx.clientId}::uuid, ${ctx.userNodeId}::uuid, ${rate}::numeric, '2026-07-01'::date)
  `;
}

async function createPeriod(ctx: Awaited<ReturnType<typeof seedWorkforceClient>>) {
  const res = await payrollHandler(req(ctx, 'POST', '/api/workforce/payroll', {
    period_start: '2026-07-01',
    period_end: '2026-07-31',
  }));
  expect(res.status).toBe(201);
  return (await res.json() as { period: { id: string } }).period.id;
}

describe('workforce payable-time reconciliation', () => {
  it('creates one payable source entry when a Team-linked timesheet is approved', async () => {
    const ctx = await seedWorkforceClient();
    await setRate(ctx);
    const created = await timesheetsHandler(req(ctx, 'POST', '/api/workforce/timesheets', {
      resource_id: ctx.resourceId,
      user_node_id: ctx.userNodeId,
      entry_date: '2026-07-14',
      start_time: '09:00',
      end_time: '17:00',
      notes: 'Approved shift',
    }));
    expect(created.status).toBe(201);
    const entryId = (await created.json() as { entry: { id: string } }).entry.id;

    const approved = await timesheetHandler(req(ctx, 'PATCH', `/api/workforce/timesheet/${entryId}`, { approve: true }));
    expect(approved.status).toBe(200);

    const payable = await sql`
      SELECT minutes, source_type, source_id, source_snapshot
      FROM public.workforce_payable_time_entries
      WHERE client_id = ${ctx.clientId}::uuid
        AND source_id = ${entryId}::uuid
    ` as Array<{ minutes: number; source_type: string; source_id: string; source_snapshot: { entry_date: string } }>;
    expect(payable).toEqual([expect.objectContaining({
      minutes: 480,
      source_type: 'approved_timesheet',
      source_id: entryId,
      source_snapshot: expect.objectContaining({ entry_date: '2026-07-14' }),
    })]);

    const periodId = await createPeriod(ctx);
    const period = await payrollDetailHandler(req(ctx, 'GET', `/api/workforce/payroll/${periodId}`));
    expect(period.status).toBe(200);
    const body = await period.json() as { line_items: Array<{ user_node_id: string; hours: number; amount: number }> };
    expect(body.line_items).toEqual([expect.objectContaining({ user_node_id: ctx.userNodeId, hours: 8, amount: 320 })]);
  });

  it('turns a manager-approved correction into a payable adjustment and leaves a denial out of payroll', async () => {
    const ctx = await seedWorkforceClient();
    await setRate(ctx);
    const created = await ledgerHandler(req(ctx, 'POST', '/api/workforce/time-ledger', {
      kind: 'correction',
      resource_id: ctx.resourceId,
      correction_type: 'missed_clock_in',
      new_values: { requested_time: '2026-07-15T09:00' },
      notes: 'Forgot to clock in',
    }));
    expect(created.status).toBe(201);
    const correctionId = (await created.json() as { correction: { id: string } }).correction.id;

    const approved = await correctionHandler(req(ctx, 'PATCH', `/api/workforce/time-correction/${correctionId}`, {
      action: 'approve',
      work_date: '2026-07-15',
      minutes: 90,
      resolution_note: 'Manager confirmed the missed time.',
    }));
    expect(approved.status).toBe(200);
    const approvedBody = await approved.json() as { correction: { status: string; payable_time_entry_id: string | null } };
    expect(approvedBody.correction.status).toBe('approved');
    expect(approvedBody.correction.payable_time_entry_id).toEqual(expect.any(String));

    const deniedCreated = await ledgerHandler(req(ctx, 'POST', '/api/workforce/time-ledger', {
      kind: 'correction',
      resource_id: ctx.resourceId,
      correction_type: 'edit_time',
      notes: 'Unsupported request',
    }));
    const deniedId = (await deniedCreated.json() as { correction: { id: string } }).correction.id;
    const denied = await correctionHandler(req(ctx, 'PATCH', `/api/workforce/time-correction/${deniedId}`, {
      action: 'deny',
      resolution_note: 'No supporting evidence was supplied.',
    }));
    expect(denied.status).toBe(200);

    const entries = await sql`
      SELECT source_id, minutes
      FROM public.workforce_payable_time_entries
      WHERE client_id = ${ctx.clientId}::uuid
        AND source_type = 'approved_correction'
    ` as Array<{ source_id: string; minutes: number }>;
    expect(entries).toEqual([{ source_id: correctionId, minutes: 90 }]);

    const periodId = await createPeriod(ctx);
    const period = await payrollDetailHandler(req(ctx, 'GET', `/api/workforce/payroll/${periodId}`));
    const body = await period.json() as { line_items: Array<{ user_node_id: string; hours: number; amount: number }> };
    expect(body.line_items).toEqual([expect.objectContaining({ user_node_id: ctx.userNodeId, hours: 1.5, amount: 60 })]);
  });
});
