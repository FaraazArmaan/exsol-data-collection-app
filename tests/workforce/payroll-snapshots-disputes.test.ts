import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import payrollHandler from '../../netlify/functions/workforce-payroll';
import payrollDetailHandler from '../../netlify/functions/workforce-payroll-id';
import payrollExportHandler from '../../netlify/functions/workforce-payroll-export';
import payrollDisputesHandler from '../../netlify/functions/workforce-payroll-disputes';
import payrollDisputeHandler from '../../netlify/functions/workforce-payroll-dispute';
import { makeBucketUserRequest, seedWorkforceClient } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

function req(ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, method: string, path: string, body?: unknown): Request {
  return makeBucketUserRequest(ctx, method, path, body);
}

describe('workforce payroll snapshots and disputes', () => {
  it('freezes approved pay, makes export idempotent, and records a dispute without changing the snapshot', async () => {
    const ctx = await seedWorkforceClient();
    await sql`
      INSERT INTO public.payroll_rates (client_id, user_node_id, hourly_rate, effective_from)
      VALUES (${ctx.clientId}::uuid, ${ctx.userNodeId}::uuid, 40::numeric, '2026-07-01'::date)
    `;
    await sql`
      INSERT INTO public.timesheet_entries (client_id, resource_id, user_node_id, entry_date, start_time, end_time, approved_by, approved_at)
      VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, ${ctx.userNodeId}::uuid, '2026-07-14'::date, '09:00'::time, '17:00'::time, ${ctx.userNodeId}::uuid, now())
    `;
    const created = await payrollHandler(req(ctx, 'POST', '/api/workforce/payroll', {
      period_start: '2026-07-01',
      period_end: '2026-07-31',
    }));
    const periodId = (await created.json() as { period: { id: string } }).period.id;

    const approved = await payrollDetailHandler(req(ctx, 'PATCH', `/api/workforce/payroll/${periodId}`, { action: 'approve' }));
    expect(approved.status).toBe(200);
    const approval = await approved.json() as { snapshot: { id: string; total_amount: number; lines: Array<{ amount: number; source_evidence: unknown[] }> } };
    expect(approval.snapshot.total_amount).toBe(320);
    expect(approval.snapshot.lines).toEqual([expect.objectContaining({ amount: 320, source_evidence: expect.any(Array) })]);

    await sql`
      UPDATE public.payroll_rates
      SET hourly_rate = 100::numeric
      WHERE client_id = ${ctx.clientId}::uuid AND user_node_id = ${ctx.userNodeId}::uuid AND effective_from = '2026-07-01'::date
    `;
    const detail = await payrollDetailHandler(req(ctx, 'GET', `/api/workforce/payroll/${periodId}`));
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as { snapshot: { status: string }; line_items: Array<{ amount: number }> };
    expect(detailBody.snapshot.status).toBe('frozen');
    expect(detailBody.line_items).toEqual([expect.objectContaining({ amount: 320 })]);

    const firstExport = await payrollExportHandler(req(ctx, 'POST', '/api/workforce/payroll-export', { period_id: periodId }));
    expect(firstExport.status).toBe(201);
    const firstExportBody = await firstExport.json() as { export: { id: string; total_amount: number }; payslips: unknown[] };
    expect(Number(firstExportBody.export.total_amount)).toBe(320);
    expect(firstExportBody.payslips).toHaveLength(1);
    const secondExport = await payrollExportHandler(req(ctx, 'POST', '/api/workforce/payroll-export', { period_id: periodId }));
    expect(secondExport.status).toBe(200);
    const secondExportBody = await secondExport.json() as { export: { id: string }; reused: boolean };
    expect(secondExportBody).toMatchObject({ reused: true, export: { id: firstExportBody.export.id } });

    const opened = await payrollDisputesHandler(req(ctx, 'POST', '/api/workforce/payroll-disputes', {
      period_id: periodId,
      user_node_id: ctx.userNodeId,
      reason: 'Approved time needs manager review.',
    }));
    expect(opened.status).toBe(201);
    const disputeId = (await opened.json() as { dispute: { id: string } }).dispute.id;
    const resolved = await payrollDisputeHandler(req(ctx, 'PATCH', `/api/workforce/payroll-dispute/${disputeId}`, {
      action: 'resolve',
      resolution_note: 'Carry the verified adjustment into the next draft period.',
    }));
    expect(resolved.status).toBe(200);
    const finalDetail = await payrollDetailHandler(req(ctx, 'GET', `/api/workforce/payroll/${periodId}`));
    expect((await finalDetail.json() as { line_items: Array<{ amount: number }> }).line_items).toEqual([expect.objectContaining({ amount: 320 })]);
  });
});
