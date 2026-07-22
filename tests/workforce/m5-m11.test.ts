import { describe, it, expect, beforeAll } from 'vitest';
import { neon } from '@neondatabase/serverless';
import employeeMaster from '../../netlify/functions/workforce-employee-master';
import schedulePlanner from '../../netlify/functions/workforce-schedule-planner';
import timeLedger from '../../netlify/functions/workforce-time-ledger';
import leaveAccrual from '../../netlify/functions/workforce-leave-accrual';
import payrollExport from '../../netlify/functions/workforce-payroll-export';
import payrollPeriod from '../../netlify/functions/workforce-payroll-id';
import complianceOps from '../../netlify/functions/workforce-compliance-ops';
import reportingDashboard from '../../netlify/functions/workforce-reporting-dashboard';
import { randName, seedShift, seedWorkforceClient } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

let ctx: Awaited<ReturnType<typeof seedWorkforceClient>>;

beforeAll(async () => {
  ctx = await seedWorkforceClient();
});

function req(method: string, url: string, body?: unknown, cookie = ctx.cookie): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe('workforce M5-M11 depth endpoints', () => {
  it('M5 creates and lists an employee master profile', async () => {
    const employeeNumber = randName('EMP');
    const post = await employeeMaster(req('POST', 'http://localhost/api/workforce/employee-master', {
      resource_id: ctx.resourceId,
      user_node_id: ctx.userNodeId,
      employee_number: employeeNumber,
      legal_name: 'M5 Test Employee',
      preferred_name: 'M5',
      employment_type: 'full_time',
      job_title: 'Scheduler',
      emergency_contact: { name: 'Contact' },
    }));
    expect(post.status).toBe(201);
    const created = await post.json() as { profile: { resource_id: string; employee_number: string } };
    expect(created.profile.resource_id).toBe(ctx.resourceId);
    expect(created.profile.employee_number).toBe(employeeNumber);

    const get = await employeeMaster(req('GET', 'http://localhost/api/workforce/employee-master?status=active'));
    expect(get.status).toBe(200);
    const listed = await get.json() as { profiles: Array<{ employee_number: string }> };
    expect(listed.profiles.some(profile => profile.employee_number === employeeNumber)).toBe(true);
  });

  it('M5 rejects malformed optional UUID fields instead of throwing', async () => {
    const post = await employeeMaster(req('POST', 'http://localhost/api/workforce/employee-master', {
      resource_id: ctx.resourceId,
      user_node_id: 'not-a-uuid',
      legal_name: 'Bad UUID Employee',
    }));
    expect(post.status).toBe(400);
    expect(await post.json()).toMatchObject({ error: { code: 'invalid_user_node_id' } });
  });

  it('M6 creates a scheduling compliance rule and computes a daily plan', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await seedShift(ctx, ctx.resourceId, new Date(`${today}T00:00:00Z`).getUTCDay(), '08:00', '20:00');

    const post = await schedulePlanner(req('POST', 'http://localhost/api/workforce/schedule-planner', {
      name: randName('Daily max'),
      max_daily_hours: 8,
      effective_from: today,
    }));
    expect(post.status).toBe(201);

    const get = await schedulePlanner(req('GET', `http://localhost/api/workforce/schedule-planner?date=${today}`));
    expect(get.status).toBe(200);
    const data = await get.json() as { plans: Array<{ resource_id: string; max_daily_hours_exceeded: boolean }> };
    expect(data.plans.some(plan => plan.resource_id === ctx.resourceId && plan.max_daily_hours_exceeded)).toBe(true);
  });

  it('M7 appends time clock events and correction requests', async () => {
    const eventRes = await timeLedger(req('POST', 'http://localhost/api/workforce/time-ledger', {
      kind: 'event',
      resource_id: ctx.resourceId,
      user_node_id: ctx.userNodeId,
      event_type: 'clock_in',
      source: 'manual',
    }));
    expect(eventRes.status).toBe(201);
    const event = await eventRes.json() as { event: { resource_id: string; event_type: string } };
    expect(event.event.resource_id).toBe(ctx.resourceId);
    expect(event.event.event_type).toBe('clock_in');

    const correctionRes = await timeLedger(req('POST', 'http://localhost/api/workforce/time-ledger', {
      kind: 'correction',
      resource_id: ctx.resourceId,
      correction_type: 'edit_time',
      original_values: { in: '09:10' },
      new_values: { in: '09:00' },
    }));
    expect(correctionRes.status).toBe(201);

    const get = await timeLedger(req('GET', `http://localhost/api/workforce/time-ledger?resource_id=${ctx.resourceId}`));
    expect(get.status).toBe(200);
    const data = await get.json() as { events: unknown[]; corrections: unknown[] };
    expect(data.events.length).toBeGreaterThan(0);
    expect(data.corrections.length).toBeGreaterThan(0);
  });

  it('M7 rejects malformed resource_id filters instead of throwing', async () => {
    const get = await timeLedger(req('GET', 'http://localhost/api/workforce/time-ledger?resource_id=bad-id'));
    expect(get.status).toBe(400);
    expect(await get.json()).toMatchObject({ error: { code: 'invalid_resource_id' } });
  });

  it('M8 creates leave policy, holiday, and ledger entries', async () => {
    const policy = await leaveAccrual(req('POST', 'http://localhost/api/workforce/leave-accrual', {
      kind: 'policy',
      leave_type: 'annual',
      accrual_rate_days: 1.5,
      accrual_period: 'monthly',
    }));
    expect(policy.status).toBe(201);

    const holiday = await leaveAccrual(req('POST', 'http://localhost/api/workforce/leave-accrual', {
      kind: 'holiday',
      name: randName('Holiday'),
      holiday_date: '2026-12-25',
      paid: true,
    }));
    expect(holiday.status).toBe(201);

    const ledger = await leaveAccrual(req('POST', 'http://localhost/api/workforce/leave-accrual', {
      kind: 'ledger',
      resource_id: ctx.resourceId,
      leave_type: 'annual',
      entry_type: 'accrual',
      days_delta: 1.5,
      entry_date: '2026-01-31',
    }));
    expect(ledger.status).toBe(201);

    const get = await leaveAccrual(req('GET', `http://localhost/api/workforce/leave-accrual?resource_id=${ctx.resourceId}`));
    expect(get.status).toBe(200);
    const data = await get.json() as { policies: unknown[]; holidays: unknown[]; ledger: unknown[] };
    expect(data.policies.length).toBeGreaterThan(0);
    expect(data.holidays.length).toBeGreaterThan(0);
    expect(data.ledger.length).toBeGreaterThan(0);
  });

  it('M9 generates a payroll export and payslip from approved time', async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const start = `2026-02-${suffix.length.toString().padStart(2, '0')}`;
    const end = `2026-02-${(suffix.length + 1).toString().padStart(2, '0')}`;
    await sql`
      INSERT INTO public.payroll_rates (client_id, user_node_id, hourly_rate, effective_from)
      VALUES (${ctx.clientId}::uuid, ${ctx.userNodeId}::uuid, 40, '2026-01-01'::date)
      ON CONFLICT (client_id, user_node_id, effective_from) DO UPDATE SET hourly_rate = EXCLUDED.hourly_rate
    `;
    const periodRows = await sql`
      INSERT INTO public.payroll_periods (client_id, period_start, period_end, created_by)
      VALUES (${ctx.clientId}::uuid, ${start}::date, ${end}::date, ${ctx.userNodeId}::uuid)
      RETURNING id
    ` as Array<{ id: string }>;
    await sql`
      INSERT INTO public.timesheet_entries (client_id, resource_id, user_node_id, entry_date, start_time, end_time, approved_by, approved_at)
      VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, ${ctx.userNodeId}::uuid, ${start}::date, '09:00'::time, '17:00'::time, ${ctx.userNodeId}::uuid, now())
    `;

    const approved = await payrollPeriod(req('PATCH', `http://localhost/api/workforce/payroll/${periodRows[0]!.id}`, { action: 'approve' }));
    expect(approved.status).toBe(200);

    const post = await payrollExport(req('POST', 'http://localhost/api/workforce/payroll-export', {
      period_id: periodRows[0]!.id,
      export_format: 'csv',
    }));
    expect(post.status).toBe(201);
    const created = await post.json() as { export: { total_amount: string | number }; payslips: unknown[] };
    expect(Number(created.export.total_amount)).toBe(320);
    expect(created.payslips.length).toBe(1);
  });

  it('M10 creates compliance requirements, maintenance rows, and tasks', async () => {
    const assetRows = await sql`
      INSERT INTO public.workforce_assets (client_id, name)
      VALUES (${ctx.clientId}::uuid, ${randName('Asset')})
      RETURNING id
    ` as Array<{ id: string }>;
    const reqRes = await complianceOps(req('POST', 'http://localhost/api/workforce/compliance-ops', {
      kind: 'requirement',
      requirement_type: 'asset',
      name: randName('Asset inspection'),
      asset_id: assetRows[0]!.id,
      due_within_days: 30,
    }));
    expect(reqRes.status).toBe(201);
    const requirement = await reqRes.json() as { requirement: { id: string } };

    const maintenance = await complianceOps(req('POST', 'http://localhost/api/workforce/compliance-ops', {
      kind: 'maintenance',
      asset_id: assetRows[0]!.id,
      scheduled_for: '2026-03-01',
    }));
    expect(maintenance.status).toBe(201);

    const task = await complianceOps(req('POST', 'http://localhost/api/workforce/compliance-ops', {
      kind: 'task',
      requirement_id: requirement.requirement.id,
      resource_id: ctx.resourceId,
      user_node_id: ctx.userNodeId,
      due_date: '2026-03-01',
    }));
    expect(task.status).toBe(201);
  });

  it('M11 returns live reporting metrics and saves a dashboard snapshot', async () => {
    const get = await reportingDashboard(req('GET', 'http://localhost/api/workforce/reporting-dashboard'));
    expect(get.status).toBe(200);
    const live = await get.json() as { metrics: Record<string, number> };
    expect(typeof live.metrics.active_profiles).toBe('number');

    const post = await reportingDashboard(req('POST', 'http://localhost/api/workforce/reporting-dashboard', {
      snapshot_date: '2026-04-01',
      metrics: { active_profiles: 1 },
    }));
    expect(post.status).toBe(201);
    const snapshot = await post.json() as { snapshot: { snapshot_date: string; metrics: { active_profiles: number } } };
    expect(snapshot.snapshot.snapshot_date).toBe('2026-04-01');
    expect(snapshot.snapshot.metrics.active_profiles).toBe(1);
  });
});
