import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import staffHandler from '../../netlify/functions/workforce-staff';
import { seedWorkforceClient, makeBucketUserRequest, randName } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

const list = (ctx: Awaited<ReturnType<typeof seedWorkforceClient>>) =>
  staffHandler(makeBucketUserRequest(ctx, 'GET', '/api/workforce/staff'));

describe('workforce-staff', () => {
  it('lists booking resources but only attaches their linked Team user', async () => {
    const ctx = await seedWorkforceClient();
    const unlinked = await sql`
      INSERT INTO public.booking_resources (bucket_id, name)
      VALUES (${ctx.clientId}::uuid, 'tea')
      RETURNING id
    ` as Array<{ id: string }>;
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
    const res = await list(ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      resources: Array<{
        id: string;
        team_members: Array<{
          id: string;
          display_name: string;
          email: string | null;
          level_number: number | null;
          role_label: string | null;
          has_login: boolean;
          login_disabled: boolean;
        }>;
      }>;
    };
    const found = body.resources.find((r) => r.id === ctx.resourceId);
    expect(found).toBeDefined();
    expect(Array.isArray(found!.team_members)).toBe(true);
    expect(found!.team_members).toHaveLength(1);
    expect(found!.team_members[0]).toMatchObject({
      id: ctx.userNodeId,
      display_name: expect.any(String),
      has_login: expect.any(Boolean),
      login_disabled: expect.any(Boolean),
    });
    const tea = body.resources.find((r) => r.id === unlinked[0]!.id);
    expect(tea).toBeDefined();
    expect(tea!.team_members).toHaveLength(0);
  });

  it('405 on POST', async () => {
    const ctx = await seedWorkforceClient();
    const res = await staffHandler(makeBucketUserRequest(ctx, 'POST', '/api/workforce/staff'));
    expect(res.status).toBe(405);
  });

  it('401 without auth', async () => {
    const res = await staffHandler(new Request('http://localhost/api/workforce/staff'));
    expect(res.status).toBe(401);
  });

  it('412 when workforce product not enabled', async () => {
    // Use a base POS context that has products+pos but NOT workforce enabled.
    const { seedClientWithProductsEnabled } = await import('../pos/_helpers');
    const ctx = await seedClientWithProductsEnabled();
    const res = await staffHandler(makeBucketUserRequest(ctx, 'GET', '/api/workforce/staff'));
    expect(res.status).toBe(412);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('workforce_module_not_enabled');
  });
});
