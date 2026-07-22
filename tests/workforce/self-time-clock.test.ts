import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import statusHandler from '../../netlify/functions/workforce-me-time-status';
import clockInHandler from '../../netlify/functions/workforce-me-clock-in';
import clockOutHandler from '../../netlify/functions/workforce-me-clock-out';
import startBreakHandler from '../../netlify/functions/workforce-me-start-break';
import endBreakHandler from '../../netlify/functions/workforce-me-end-break';
import workLocationsHandler from '../../netlify/functions/workforce-work-locations';
import { makeBucketUserRequest, randName, seedWorkforceClient } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

async function linkEmployee(ctx: Awaited<ReturnType<typeof seedWorkforceClient>>) {
  await sql`
    INSERT INTO public.workforce_employee_profiles (
      client_id, resource_id, user_node_id, legal_name, employment_status, employment_type
    )
    VALUES (
      ${ctx.clientId}::uuid,
      ${ctx.resourceId}::uuid,
      ${ctx.userNodeId}::uuid,
      ${randName('Employee')}::text,
      'active',
      'full_time'
    )
  `;
}

function req(ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, method: string, path: string, body?: unknown) {
  return makeBucketUserRequest(ctx, method, path, body);
}

describe('workforce self-service geofenced time clock', () => {
  it('does not create an employment record solely because a Team user opens attendance', async () => {
    const ctx = await seedWorkforceClient();
    const res = await statusHandler(req(ctx, 'GET', '/api/workforce/me/time-status'));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('employee_profile_not_linked');
    const profiles = await sql`
      SELECT id
      FROM public.workforce_employee_profiles
      WHERE client_id = ${ctx.clientId}::uuid
        AND user_node_id = ${ctx.userNodeId}::uuid
    `;
    expect(profiles).toHaveLength(0);
  });

  it('blocks clock-in until a work location is assigned', async () => {
    const ctx = await seedWorkforceClient();
    await linkEmployee(ctx);
    const res = await clockInHandler(req(ctx, 'POST', '/api/workforce/me/clock-in', {
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy_meters: 20,
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('geofence_unconfigured');
  });

  it('geofences clock-in and supports break plus clock-out lifecycle for the logged-in employee', async () => {
    const ctx = await seedWorkforceClient();
    await linkEmployee(ctx);

    const createLocation = await workLocationsHandler(req(ctx, 'POST', '/api/workforce/work-locations', {
      name: randName('Store'),
      latitude: 12.9716,
      longitude: 77.5946,
      radius_meters: 120,
      min_accuracy_meters: 80,
      applies_to_all: true,
    }));
    expect(createLocation.status).toBe(201);

    const status = await statusHandler(req(ctx, 'GET', '/api/workforce/me/time-status'));
    expect(status.status).toBe(200);
    expect((await status.json()).locations).toHaveLength(1);

    const outside = await clockInHandler(req(ctx, 'POST', '/api/workforce/me/clock-in', {
      latitude: 13.0500,
      longitude: 77.7000,
      accuracy_meters: 20,
    }));
    expect(outside.status).toBe(403);
    expect((await outside.json()).error.code).toBe('outside_geofence');

    const inside = await clockInHandler(req(ctx, 'POST', '/api/workforce/me/clock-in', {
      latitude: 12.97161,
      longitude: 77.59461,
      accuracy_meters: 20,
    }));
    expect(inside.status).toBe(201);
    const punch = (await inside.json()).punch as { user_node_id: string; resource_id: string };
    expect(punch.user_node_id).toBe(ctx.userNodeId);
    expect(punch.resource_id).toBe(ctx.resourceId);

    const startBreak = await startBreakHandler(req(ctx, 'POST', '/api/workforce/me/start-break', {}));
    expect(startBreak.status).toBe(201);

    const doubleBreak = await startBreakHandler(req(ctx, 'POST', '/api/workforce/me/start-break', {}));
    expect(doubleBreak.status).toBe(409);
    expect((await doubleBreak.json()).error.code).toBe('break_already_open');

    const blockedClockOut = await clockOutHandler(req(ctx, 'POST', '/api/workforce/me/clock-out', {}));
    expect(blockedClockOut.status).toBe(409);
    expect((await blockedClockOut.json()).error.code).toBe('break_open');

    const endBreak = await endBreakHandler(req(ctx, 'POST', '/api/workforce/me/end-break', {}));
    expect(endBreak.status).toBe(200);

    const clockOut = await clockOutHandler(req(ctx, 'POST', '/api/workforce/me/clock-out', {}));
    expect(clockOut.status).toBe(200);
    expect((await clockOut.json()).punch.punched_out_at).not.toBeNull();
  });
});
