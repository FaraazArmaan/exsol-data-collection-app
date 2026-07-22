import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import directoryHandler from '../../netlify/functions/workforce-employees-directory';
import employeeMasterHandler from '../../netlify/functions/workforce-employee-master';
import { seedSubordinateUser } from '../pos/_helpers';
import { makeBucketUserRequest, randName, seedWorkforceClient } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

describe('workforce employees directory', () => {
  it('lists Team users as setup candidates without silently creating employment records', async () => {
    const ctx = await seedWorkforceClient();
    const employeeUser = await seedSubordinateUser(ctx, 2);
    await sql`
      INSERT INTO public.booking_resources (bucket_id, name)
      VALUES (${ctx.clientId}::uuid, 'tea')
    `;

    const before = await directoryHandler(makeBucketUserRequest(ctx, 'GET', '/api/workforce/employees-directory'));
    expect(before.status).toBe(200);
    const beforeBody = await before.json() as {
      employees: Array<{
        user_node_id: string | null;
        display_name: string;
        resource_name: string | null;
        profile_id: string | null;
        active_work_location_count: number;
        has_recurring_shift: boolean;
      }>;
    };
    expect(beforeBody.employees.some((row) => row.display_name === 'tea' || row.resource_name === 'tea')).toBe(false);
    const autoRow = beforeBody.employees.find((row) => row.user_node_id === employeeUser.userNodeId);
    expect(autoRow).toMatchObject({
      profile_id: null,
      resource_name: null,
      active_work_location_count: 0,
      has_recurring_shift: false,
    });

    const save = await employeeMasterHandler(makeBucketUserRequest(ctx, 'POST', '/api/workforce/employee-master', {
      user_node_id: employeeUser.userNodeId,
      legal_name: 'Front Desk Employee',
      employment_status: 'active',
      employment_type: 'full_time',
    }));
    expect(save.status).toBe(201);
    const saved = await save.json() as { profile: { resource_id: string; user_node_id: string; legal_name: string } };
    expect(saved.profile.user_node_id).toBe(employeeUser.userNodeId);
    expect(saved.profile.resource_id).toEqual(expect.any(String));

    const resources = await sql`
      SELECT name
      FROM public.booking_resources
      WHERE id = ${saved.profile.resource_id}::uuid
        AND bucket_id = ${ctx.clientId}::uuid
    ` as Array<{ name: string }>;
    expect(resources[0]?.name).toEqual(expect.any(String));

    const locationRows = await sql`
      INSERT INTO public.workforce_work_locations (client_id, name, latitude, longitude, created_by)
      VALUES (${ctx.clientId}::uuid, ${randName('Worksite')}::text, 12.9716, 77.5946, ${ctx.userNodeId}::uuid)
      RETURNING id
    ` as Array<{ id: string }>;
    await sql`
      INSERT INTO public.workforce_work_location_assignments (client_id, work_location_id, applies_to_all)
      VALUES (${ctx.clientId}::uuid, ${locationRows[0]!.id}::uuid, true)
    `;
    await sql`
      INSERT INTO public.workforce_shifts (client_id, resource_id, weekday, start_time, end_time)
      VALUES (${ctx.clientId}::uuid, ${saved.profile.resource_id}::uuid, 1, '09:00'::time, '17:00'::time)
    `;

    const after = await directoryHandler(makeBucketUserRequest(ctx, 'GET', '/api/workforce/employees-directory'));
    expect(after.status).toBe(200);
    const afterBody = await after.json() as {
      employees: Array<{
        user_node_id: string | null;
        legal_name: string | null;
        resource_name: string | null;
        profile_id: string | null;
        active_work_location_count: number;
        has_recurring_shift: boolean;
      }>;
    };
    const row = afterBody.employees.find((item) => item.user_node_id === employeeUser.userNodeId);
    expect(row).toMatchObject({
      legal_name: 'Front Desk Employee',
      resource_name: expect.any(String),
      profile_id: expect.any(String),
      active_work_location_count: 1,
      has_recurring_shift: true,
    });
    expect(afterBody.employees.some((item) => item.resource_name === 'tea')).toBe(false);
  });
});
