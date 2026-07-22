import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import dashboardHandler from '../../netlify/functions/workforce-me-dashboard';
import acknowledgeHandler from '../../netlify/functions/workforce-me-schedule-notice';
import correctionHandler from '../../netlify/functions/workforce-me-time-correction';
import correctionItemHandler from '../../netlify/functions/workforce-me-time-correction-id';
import publicationHandler from '../../netlify/functions/workforce-schedule-publication';
import { makeBucketUserRequest, seedWorkforceClient } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

async function linkEmployee(ctx: Awaited<ReturnType<typeof seedWorkforceClient>>) {
  await sql`
    INSERT INTO public.workforce_employee_profiles (
      client_id, resource_id, user_node_id, legal_name, employment_status, employment_type
    )
    VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, ${ctx.userNodeId}::uuid, 'Schedule Employee', 'active', 'full_time')
  `;
}

function request(ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, method: string, path: string, body?: unknown) {
  return makeBucketUserRequest(ctx, method, path, body);
}

describe('workforce X05 self-service and X06 schedule publication', () => {
  it('lets an employee cancel only a pending correction and retains a cancellation audit event', async () => {
    const ctx = await seedWorkforceClient();
    await linkEmployee(ctx);

    const created = await correctionHandler(request(ctx, 'POST', '/api/workforce/me/time-correction', {
      correction_type: 'missed_clock_in',
      new_values: { requested_at: '2099-01-05T09:00' },
      notes: 'Submitted in error',
    }));
    expect(created.status).toBe(201);
    const correction = await created.json() as { correction: { id: string } };

    const cancelled = await correctionItemHandler(request(ctx, 'DELETE', `/api/workforce/me/time-correction/${correction.correction.id}`));
    expect(cancelled.status).toBe(204);
    const retained = await sql`
      SELECT status, resolution_note
      FROM public.workforce_time_corrections
      WHERE id = ${correction.correction.id}::uuid
    ` as Array<{ status: string; resolution_note: string | null }>;
    expect(retained[0]).toMatchObject({ status: 'cancelled', resolution_note: 'Cancelled by employee' });

    const repeated = await correctionItemHandler(request(ctx, 'DELETE', `/api/workforce/me/time-correction/${correction.correction.id}`));
    expect(repeated.status).toBe(409);

    const events = await sql`
      SELECT notes
      FROM public.workforce_time_clock_events
      WHERE client_id = ${ctx.clientId}::uuid
        AND resource_id = ${ctx.resourceId}::uuid
        AND notes = 'Employee cancelled correction request.'
    ` as Array<{ notes: string }>;
    expect(events).toHaveLength(1);
  });

  it('publishes an immutable weekly snapshot, supersedes the prior publication, and lets the employee acknowledge it', async () => {
    const ctx = await seedWorkforceClient();
    await linkEmployee(ctx);
    await sql`
      INSERT INTO public.workforce_shifts (client_id, resource_id, user_node_id, weekday, start_time, end_time)
      VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, ${ctx.userNodeId}::uuid, 1, '09:00'::time, '17:00'::time)
    `;

    const first = await publicationHandler(request(ctx, 'POST', '/api/workforce/schedule-publication', {
      week_start: '2099-01-05',
      acknowledgement_required: true,
    }));
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { version: { id: string }; shifts: Array<{ shift_date: string }>; notice_summary: { recipients: number } };
    expect(firstBody.shifts).toHaveLength(1);
    expect(firstBody.shifts[0]?.shift_date).toBe('2099-01-05');
    expect(firstBody.notice_summary.recipients).toBe(1);

    const second = await publicationHandler(request(ctx, 'POST', '/api/workforce/schedule-publication', {
      week_start: '2099-01-05',
      acknowledgement_required: true,
    }));
    expect(second.status).toBe(201);
    const secondBody = await second.json() as { version: { id: string } };
    expect(secondBody.version.id).not.toBe(firstBody.version.id);

    const oldVersion = await sql`
      SELECT status
      FROM public.workforce_schedule_versions
      WHERE id = ${firstBody.version.id}::uuid
    ` as Array<{ status: string }>;
    expect(oldVersion[0]?.status).toBe('superseded');

    const dashboard = await dashboardHandler(request(ctx, 'GET', '/api/workforce/me/dashboard'));
    expect(dashboard.status).toBe(200);
    const dashboardBody = await dashboard.json() as { published_schedule: Array<{ notice_id: string; acknowledged_at: string | null }> };
    expect(dashboardBody.published_schedule).toHaveLength(1);
    const noticeId = dashboardBody.published_schedule[0]!.notice_id;

    const acknowledged = await acknowledgeHandler(request(ctx, 'PATCH', `/api/workforce/me/schedule-notice/${noticeId}`));
    expect(acknowledged.status).toBe(200);
    const afterAcknowledgement = await dashboardHandler(request(ctx, 'GET', '/api/workforce/me/dashboard'));
    const afterBody = await afterAcknowledgement.json() as { published_schedule: Array<{ acknowledged_at: string | null }> };
    expect(afterBody.published_schedule[0]?.acknowledged_at).not.toBeNull();
  });
});
