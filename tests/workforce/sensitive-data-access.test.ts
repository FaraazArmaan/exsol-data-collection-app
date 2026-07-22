import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import directoryHandler from '../../netlify/functions/workforce-employees-directory';
import grantsHandler from '../../netlify/functions/workforce-sensitive-access';
import payrollRatesHandler from '../../netlify/functions/workforce-payroll-rates';
import ledgerHandler from '../../netlify/functions/workforce-time-ledger';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import { mintBucketUserSession } from '../../netlify/functions/_shared/session';
import { makeBucketUserRequest, seedSecondNode, seedWorkforceClient } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

type WorkforceCtx = Awaited<ReturnType<typeof seedWorkforceClient>>;

function ownerReq(ctx: WorkforceCtx, method: string, path: string, body?: unknown) {
  return makeBucketUserRequest(ctx, method, path, body);
}

async function managerReq(ctx: WorkforceCtx, userNodeId: string, method: string, path: string): Promise<Request> {
  const node = (await sql`SELECT email FROM public.user_nodes WHERE id = ${userNodeId}::uuid`) as Array<{ email: string }>;
  const email = node[0]!.email;
  await sql`
    INSERT INTO public.client_levels (client_id, level_number, label, permissions)
    VALUES (${ctx.clientId}::uuid, 2, 'Manager', '{"workforce.employees.view": true, "workforce.payroll.view": true}'::jsonb)
    ON CONFLICT (client_id, level_number) DO UPDATE SET permissions = EXCLUDED.permissions
  `;
  await sql`
    INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
    VALUES (${ctx.clientId}::uuid, ${userNodeId}::uuid, ${email}, ${await hashPassword('sensitive-access-test-password')}, false, ${ctx.adminId}::uuid)
    ON CONFLICT (user_node_id) DO NOTHING
  `;
  const token = await mintBucketUserSession({ sub: userNodeId, email, client_id: ctx.clientId });
  return new Request(`http://localhost${path}`, { method, headers: { cookie: `bu_session=${token}` } });
}

describe('workforce sensitive-data access', () => {
  it('redacts profile data by default and exposes it only through an Owner-granted scope', async () => {
    const ctx = await seedWorkforceClient();
    const managerId = await seedSecondNode(ctx);
    await sql`
      INSERT INTO public.workforce_employee_profiles (client_id, resource_id, user_node_id, legal_name, manager_user_node_id, primary_email, primary_phone, emergency_contact, custom_fields)
      VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, ${ctx.userNodeId}::uuid, 'Private Employee', ${ctx.userNodeId}::uuid, 'private@example.test', '+155555501', '{"name":"Emergency Contact"}'::jsonb, '{"medical_note":"private"}'::jsonb)
    `;
    const managerRequest = await managerReq(ctx, managerId, 'GET', '/api/workforce/employees-directory');
    const hidden = await directoryHandler(managerRequest);
    expect(hidden.status).toBe(200);
    const hiddenBody = await hidden.json() as { employees: Array<{ user_node_id: string; primary_email: string | null; emergency_contact: unknown; can_view_sensitive: boolean }> };
    expect(hiddenBody.employees.find(employee => employee.user_node_id === ctx.userNodeId)).toMatchObject({ primary_email: null, emergency_contact: null, can_view_sensitive: false });

    const grant = await grantsHandler(ownerReq(ctx, 'POST', '/api/workforce/sensitive-access', {
      user_node_id: managerId, data_scope: 'profile', reason: 'HR cover for employee records', active: true,
    }));
    expect(grant.status).toBe(200);
    const visible = await directoryHandler(await managerReq(ctx, managerId, 'GET', '/api/workforce/employees-directory'));
    const visibleBody = await visible.json() as { employees: Array<{ user_node_id: string; primary_email: string | null; emergency_contact: unknown; can_view_sensitive: boolean }> };
    expect(visibleBody.employees.find(employee => employee.user_node_id === ctx.userNodeId)).toMatchObject({ primary_email: 'private@example.test', can_view_sensitive: true });
    const audit = await sql`
      SELECT access_basis FROM public.workforce_sensitive_data_access_events
      WHERE client_id = ${ctx.clientId}::uuid AND actor_user_node_id = ${managerId}::uuid AND data_scope = 'profile'
    ` as Array<{ access_basis: string }>;
    expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ access_basis: 'grant' })]));
  });

  it('requires separate scopes for compensation and exact location history', async () => {
    const ctx = await seedWorkforceClient();
    const managerId = await seedSecondNode(ctx);
    expect((await payrollRatesHandler(await managerReq(ctx, managerId, 'GET', '/api/workforce/payroll-rates'))).status).toBe(403);
    expect((await ledgerHandler(await managerReq(ctx, managerId, 'GET', '/api/workforce/time-ledger?include_location=true'))).status).toBe(403);

    for (const data_scope of ['compensation', 'location_history'] as const) {
      const grant = await grantsHandler(ownerReq(ctx, 'POST', '/api/workforce/sensitive-access', {
        user_node_id: managerId, data_scope, reason: `Temporary ${data_scope} cover`, active: true,
      }));
      expect(grant.status).toBe(200);
    }
    expect((await payrollRatesHandler(await managerReq(ctx, managerId, 'GET', '/api/workforce/payroll-rates'))).status).toBe(200);
    expect((await ledgerHandler(await managerReq(ctx, managerId, 'GET', '/api/workforce/time-ledger?include_location=true'))).status).toBe(200);
  });
});
