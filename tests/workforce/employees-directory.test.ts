import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import directoryHandler from '../../netlify/functions/workforce-employees-directory';
import employeeMasterHandler from '../../netlify/functions/workforce-employee-master';
import { seedSubordinateUser } from '../pos/_helpers';
import { makeBucketUserRequest, seedWorkforceClient } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

describe('workforce employees directory', () => {
  it('is Team-first and does not expose unlinked booking resources as employees', async () => {
    const ctx = await seedWorkforceClient();
    const employeeUser = await seedSubordinateUser(ctx, 2);
    await sql`
      INSERT INTO public.booking_resources (bucket_id, name)
      VALUES (${ctx.clientId}::uuid, 'tea')
    `;

    const before = await directoryHandler(makeBucketUserRequest(ctx, 'GET', '/api/workforce/employees-directory'));
    expect(before.status).toBe(200);
    const beforeBody = await before.json() as {
      employees: Array<{ user_node_id: string | null; display_name: string; resource_name: string | null; profile_id: string | null }>;
    };
    expect(beforeBody.employees.some((row) => row.display_name === 'tea' || row.resource_name === 'tea')).toBe(false);
    const autoRow = beforeBody.employees.find((row) => row.user_node_id === employeeUser.userNodeId);
    expect(autoRow).toMatchObject({
      profile_id: expect.any(String),
      resource_name: expect.any(String),
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

    const after = await directoryHandler(makeBucketUserRequest(ctx, 'GET', '/api/workforce/employees-directory'));
    expect(after.status).toBe(200);
    const afterBody = await after.json() as {
      employees: Array<{ user_node_id: string | null; legal_name: string | null; resource_name: string | null; profile_id: string | null }>;
    };
    const row = afterBody.employees.find((item) => item.user_node_id === employeeUser.userNodeId);
    expect(row).toMatchObject({
      legal_name: 'Front Desk Employee',
      resource_name: expect.any(String),
      profile_id: expect.any(String),
    });
    expect(afterBody.employees.some((item) => item.resource_name === 'tea')).toBe(false);
  });
});
