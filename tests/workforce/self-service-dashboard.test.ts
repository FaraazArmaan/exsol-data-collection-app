import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import dashboardHandler from '../../netlify/functions/workforce-me-dashboard';
import leaveRequestsHandler from '../../netlify/functions/workforce-me-leave-requests';
import leaveRequestHandler from '../../netlify/functions/workforce-me-leave-request';
import shiftSwapsHandler from '../../netlify/functions/workforce-me-shift-swaps';
import shiftSwapHandler from '../../netlify/functions/workforce-me-shift-swap';
import { seedSubordinateUser } from '../pos/_helpers';
import { makeBucketUserRequest, randName, seedShift, seedWorkforceClient } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

async function seedResource(clientId: string, name = randName('Resource')): Promise<string> {
  const rows = await sql`
    INSERT INTO public.booking_resources (bucket_id, name)
    VALUES (${clientId}::uuid, ${name})
    RETURNING id
  ` as Array<{ id: string }>;
  return rows[0]!.id;
}

async function linkEmployee(args: {
  clientId: string;
  resourceId: string;
  userNodeId: string;
  legalName?: string;
}) {
  await sql`
    INSERT INTO public.workforce_employee_profiles (
      client_id, resource_id, user_node_id, legal_name, employment_status, employment_type
    )
    VALUES (
      ${args.clientId}::uuid,
      ${args.resourceId}::uuid,
      ${args.userNodeId}::uuid,
      ${args.legalName ?? randName('Employee')}::text,
      'active',
      'full_time'
    )
  `;
}

function req(ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, method: string, path: string, body?: unknown) {
  return makeBucketUserRequest(ctx, method, path, body);
}

describe('workforce employee self-service dashboard', () => {
  it('returns only the logged-in employee dashboard records across workforce systems', async () => {
    const ctx = await seedWorkforceClient();
    const otherUser = await seedSubordinateUser(ctx, 2);
    const otherResourceId = await seedResource(ctx.clientId);
    await linkEmployee({ clientId: ctx.clientId, resourceId: ctx.resourceId, userNodeId: ctx.userNodeId, legalName: 'Owner Employee' });
    await linkEmployee({ clientId: ctx.clientId, resourceId: otherResourceId, userNodeId: otherUser.userNodeId, legalName: 'Other Employee' });

    await sql`
      INSERT INTO public.leave_balances (client_id, resource_id, leave_type, balance_days)
      VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, 'annual', 8.5)
    `;
    await sql`
      INSERT INTO public.leave_requests (client_id, resource_id, user_node_id, leave_type, start_date, end_date, notes)
      VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, ${ctx.userNodeId}::uuid, 'annual', '2026-03-01'::date, '2026-03-02'::date, 'own leave')
    `;
    await sql`
      INSERT INTO public.leave_requests (client_id, resource_id, user_node_id, leave_type, start_date, end_date, notes)
      VALUES (${ctx.clientId}::uuid, ${otherResourceId}::uuid, ${otherUser.userNodeId}::uuid, 'sick', '2026-03-03'::date, '2026-03-03'::date, 'other leave')
    `;

    const shiftId = await seedShift(ctx, ctx.resourceId, 1, '09:00', '17:00');
    const otherShiftId = await seedShift(ctx, otherResourceId, 2, '10:00', '18:00');
    await sql`
      INSERT INTO public.shift_swaps (client_id, offering_shift_id, offering_resource_id, offering_date, notes)
      VALUES (${ctx.clientId}::uuid, ${otherShiftId}::uuid, ${otherResourceId}::uuid, '2026-03-04'::date, 'available')
    `;

    const periodRows = await sql`
      INSERT INTO public.payroll_periods (client_id, period_start, period_end, created_by)
      VALUES (${ctx.clientId}::uuid, '2026-02-01'::date, '2026-02-28'::date, ${ctx.userNodeId}::uuid)
      RETURNING id
    ` as Array<{ id: string }>;
    await sql`
      INSERT INTO public.workforce_payslips (client_id, period_id, user_node_id, gross_amount, net_amount, status)
      VALUES (${ctx.clientId}::uuid, ${periodRows[0]!.id}::uuid, ${ctx.userNodeId}::uuid, 1000, 900, 'published')
    `;

    const courseRows = await sql`
      INSERT INTO public.training_courses (client_id, name, is_required)
      VALUES (${ctx.clientId}::uuid, ${randName('Safety')}, true)
      RETURNING id
    ` as Array<{ id: string }>;
    await sql`
      INSERT INTO public.training_completions (client_id, course_id, resource_id, user_node_id, completed_at)
      VALUES (${ctx.clientId}::uuid, ${courseRows[0]!.id}::uuid, ${ctx.resourceId}::uuid, ${ctx.userNodeId}::uuid, '2026-02-10'::date)
    `;
    const assetRows = await sql`
      INSERT INTO public.workforce_assets (client_id, name, serial_number)
      VALUES (${ctx.clientId}::uuid, ${randName('Laptop')}, ${randName('SN')})
      RETURNING id
    ` as Array<{ id: string }>;
    await sql`
      INSERT INTO public.asset_assignments (client_id, asset_id, user_node_id)
      VALUES (${ctx.clientId}::uuid, ${assetRows[0]!.id}::uuid, ${ctx.userNodeId}::uuid)
    `;
    const requirementRows = await sql`
      INSERT INTO public.workforce_compliance_requirements (client_id, requirement_type, name, course_id)
      VALUES (${ctx.clientId}::uuid, 'training', ${randName('Policy')}, ${courseRows[0]!.id}::uuid)
      RETURNING id
    ` as Array<{ id: string }>;
    await sql`
      INSERT INTO public.workforce_compliance_tasks (client_id, requirement_id, resource_id, user_node_id, status, due_date)
      VALUES (${ctx.clientId}::uuid, ${requirementRows[0]!.id}::uuid, ${ctx.resourceId}::uuid, ${ctx.userNodeId}::uuid, 'pending', '2026-03-15'::date)
    `;

    const res = await dashboardHandler(req(ctx, 'GET', '/api/workforce/me/dashboard'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.employee.legal_name).toBe('Owner Employee');
    expect(body.leave_balances).toHaveLength(1);
    expect(body.leave_requests).toHaveLength(1);
    expect(body.leave_requests[0].notes).toBe('own leave');
    expect(body.shifts.map((s: { id: string }) => s.id)).toContain(shiftId);
    expect(body.shifts.map((s: { id: string }) => s.id)).not.toContain(otherShiftId);
    expect(body.swaps).toHaveLength(1);
    expect(body.payslips).toHaveLength(1);
    expect(body.training).toHaveLength(1);
    expect(body.assets).toHaveLength(1);
    expect(body.compliance_tasks).toHaveLength(1);
  });

  it('lets an employee create and cancel only their own pending leave request', async () => {
    const ctx = await seedWorkforceClient();
    await linkEmployee({ clientId: ctx.clientId, resourceId: ctx.resourceId, userNodeId: ctx.userNodeId });

    const create = await leaveRequestsHandler(req(ctx, 'POST', '/api/workforce/me/leave-requests', {
      leave_type: 'annual',
      start_date: '2026-04-01',
      end_date: '2026-04-02',
      notes: 'family',
    }));
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.request.resource_id).toBe(ctx.resourceId);
    expect(created.request.user_node_id).toBe(ctx.userNodeId);

    const cancel = await leaveRequestHandler(req(ctx, 'DELETE', `/api/workforce/me/leave-request/${created.request.id}`));
    expect(cancel.status).toBe(204);

    const missing = await leaveRequestHandler(req(ctx, 'DELETE', `/api/workforce/me/leave-request/${created.request.id}`));
    expect(missing.status).toBe(404);
  });

  it('scopes shift swap offers and claims to the logged-in employee resource', async () => {
    const ctx = await seedWorkforceClient();
    const otherUser = await seedSubordinateUser(ctx, 2);
    const otherResourceId = await seedResource(ctx.clientId);
    await linkEmployee({ clientId: ctx.clientId, resourceId: ctx.resourceId, userNodeId: ctx.userNodeId });
    await linkEmployee({ clientId: ctx.clientId, resourceId: otherResourceId, userNodeId: otherUser.userNodeId });

    const ownShiftId = await seedShift(ctx, ctx.resourceId, 1, '09:00', '17:00');
    const otherShiftId = await seedShift(ctx, otherResourceId, 1, '09:00', '17:00');

    const blocked = await shiftSwapsHandler(req(ctx, 'POST', '/api/workforce/me/shift-swaps', {
      shift_id: otherShiftId,
      offering_date: '2026-05-01',
    }));
    expect(blocked.status).toBe(404);
    expect((await blocked.json()).error.code).toBe('shift_not_found');

    const offerOwn = await shiftSwapsHandler(req(ctx, 'POST', '/api/workforce/me/shift-swaps', {
      shift_id: ownShiftId,
      offering_date: '2026-05-01',
    }));
    expect(offerOwn.status).toBe(201);
    const ownSwap = await offerOwn.json();

    const claimOwn = await shiftSwapHandler(req(ctx, 'PATCH', `/api/workforce/me/shift-swap/${ownSwap.swap.id}`, { action: 'claim' }));
    expect(claimOwn.status).toBe(409);
    expect((await claimOwn.json()).error.code).toBe('cannot_claim_own_swap');

    const otherOffer = await shiftSwapsHandler(makeBucketUserRequest(otherUser, 'POST', '/api/workforce/me/shift-swaps', {
      shift_id: otherShiftId,
      offering_date: '2026-05-02',
    }));
    expect(otherOffer.status).toBe(201);
    const otherSwap = await otherOffer.json();

    const claimOther = await shiftSwapHandler(req(ctx, 'PATCH', `/api/workforce/me/shift-swap/${otherSwap.swap.id}`, { action: 'claim' }));
    expect(claimOther.status).toBe(200);
    const claimed = await claimOther.json();
    expect(claimed.swap.claimed_by_resource_id).toBe(ctx.resourceId);
    expect(claimed.swap.status).toBe('claimed');
  });
});
