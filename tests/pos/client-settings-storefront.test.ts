import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import handler from '../../netlify/functions/client-settings-storefront';
import { seedClientWithProductsEnabled, makeBucketUserRequest, type PosTestCtx } from './_helpers';
import { mintBucketUserSession } from '../../netlify/functions/_shared/session';
import { hashPassword } from '../../netlify/functions/_shared/argon';

const sql = neon(process.env.DATABASE_URL!);

async function slugOf(clientId: string): Promise<string> {
  const r = (await sql`SELECT slug FROM public.clients WHERE id = ${clientId}`) as Array<{ slug: string }>;
  return r[0]!.slug;
}

// Local L2-user seed (this branch predates the shared seedSubordinateUser helper
// added on the perms branch; keeping it local avoids a merge conflict).
async function seedL2(base: PosTestCtx): Promise<PosTestCtx> {
  await sql`
    INSERT INTO public.client_levels (client_id, level_number, label, permissions)
    VALUES (${base.clientId}, 2, 'L2', '{}'::jsonb)
    ON CONFLICT (client_id, level_number) DO UPDATE SET permissions = '{}'::jsonb
  `;
  const role = (await sql`SELECT id FROM public.client_roles WHERE client_id = ${base.clientId} LIMIT 1`) as Array<{ id: string }>;
  const email = `clp-l2-${Math.random().toString(36).slice(2, 8)}@exsol.test`;
  const node = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${base.clientId}, ${base.userNodeId}, 2, ${role[0]!.id}, 'L2', ${email}, ${base.adminId})
    RETURNING id
  `) as Array<{ id: string }>;
  const hash = await hashPassword('l2-pw');
  await sql`
    INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
    VALUES (${base.clientId}, ${node[0]!.id}, ${email}, ${hash}, false, ${base.adminId})
  `;
  const token = await mintBucketUserSession({ sub: node[0]!.id, email, client_id: base.clientId });
  return { clientId: base.clientId, userNodeId: node[0]!.id, adminId: base.adminId, cookie: `bu_session=${token}` };
}

describe('PATCH/GET /api/client-settings/storefront', () => {
  it('L1 Owner enables the storefront; returns publicUrl + writes audit', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const slug = await slugOf(ctx.clientId);

    const res = await handler(makeBucketUserRequest(ctx, 'PATCH', '/api/client-settings/storefront', { enabled: true }));
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean; publicUrl: string };
    expect(body.enabled).toBe(true);
    expect(body.publicUrl).toBe(`http://localhost/storefront/${slug}/Order`);

    const row = (await sql`SELECT storefront_enabled FROM public.clients WHERE id = ${ctx.clientId}`) as Array<{ storefront_enabled: boolean }>;
    expect(row[0]!.storefront_enabled).toBe(true);

    const audit = (await sql`SELECT op FROM public.audit_log WHERE target_id = ${ctx.clientId} AND op = 'client.storefront_toggled' ORDER BY occurred_at DESC LIMIT 1`) as Array<{ op: string }>;
    expect(audit).toHaveLength(1);
  });

  it('toggles back off', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await handler(makeBucketUserRequest(ctx, 'PATCH', '/api/client-settings/storefront', { enabled: true }));
    const res = await handler(makeBucketUserRequest(ctx, 'PATCH', '/api/client-settings/storefront', { enabled: false }));
    expect(res.status).toBe(200);
    const row = (await sql`SELECT storefront_enabled FROM public.clients WHERE id = ${ctx.clientId}`) as Array<{ storefront_enabled: boolean }>;
    expect(row[0]!.storefront_enabled).toBe(false);
  });

  it('GET returns the current state + publicUrl', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await handler(makeBucketUserRequest(ctx, 'PATCH', '/api/client-settings/storefront', { enabled: true }));
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/client-settings/storefront'));
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean; publicUrl: string };
    expect(body.enabled).toBe(true);
    expect(body.publicUrl).toContain('/storefront/');
  });

  it('403 for a non-Owner lacking _platform.settings.edit', async () => {
    const base = await seedClientWithProductsEnabled();
    const sub = await seedL2(base);
    const res = await handler(makeBucketUserRequest(sub, 'PATCH', '/api/client-settings/storefront', { enabled: true }));
    expect(res.status).toBe(403);
  });

  it('400 on a non-boolean enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const res = await handler(makeBucketUserRequest(ctx, 'PATCH', '/api/client-settings/storefront', { enabled: 'yes' }));
    expect(res.status).toBe(400);
  });
});
