import { neon } from '@neondatabase/serverless';
import { mintBucketUserSession } from '../../netlify/functions/_shared/session';
import { hashPassword } from '../../netlify/functions/_shared/argon';

const sql = neon(process.env.DATABASE_URL!);
export function sqlClient() { return sql; }

let cachedAdminId: string | null = null;
async function ensureBootstrapAdmin(): Promise<string> {
  if (cachedAdminId) return cachedAdminId;
  const found = (await sql`SELECT id FROM public.admins WHERE is_bootstrap = true LIMIT 1`) as Array<{ id: string }>;
  if (found[0]) { cachedAdminId = found[0].id; return cachedAdminId; }
  const hash = await hashPassword('mkt-test-admin-pw');
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES ('mkt-test-admin@exsol.test', ${hash}, 'Mkt Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash} RETURNING id
  `) as Array<{ id: string }>;
  cachedAdminId = rows[0]!.id;
  return cachedAdminId;
}

export interface MktTestCtx { clientId: string; ownerNodeId: string; adminId: string; slug: string; cookie: string; }

export async function seedClientWithMarketing(): Promise<MktTestCtx> {
  const adminId = await ensureBootstrapAdmin();
  const slug = `mkt-test-${Math.random().toString(36).slice(2, 10)}`;
  const c = (await sql`INSERT INTO public.clients (slug, name, created_by) VALUES (${slug}, 'Mkt Test', ${adminId}) RETURNING id`) as Array<{ id: string }>;
  const clientId = c[0]!.id;
  const role = (await sql`INSERT INTO public.client_roles (client_id, key, label, color) VALUES (${clientId}, 'owner', 'Owner', '#3b82f6') RETURNING id`) as Array<{ id: string }>;
  await sql`INSERT INTO public.client_levels (client_id, level_number, label, permissions) VALUES (${clientId}, 1, 'Primary', '{}'::jsonb)`;
  const email = `mkt-owner-${slug}@exsol.test`;
  const node = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientId}, NULL, 1, ${role[0]!.id}, 'Mkt Owner', ${email}, ${adminId}) RETURNING id`) as Array<{ id: string }>;
  const ownerNodeId = node[0]!.id;
  const hash = await hashPassword('mkt-owner-pw');
  await sql`INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
            VALUES (${clientId}, ${ownerNodeId}, ${email}, ${hash}, false, ${adminId})`;
  const token = await mintBucketUserSession({ sub: ownerNodeId, email, client_id: clientId });
  return { clientId, ownerNodeId, adminId, slug, cookie: `bu_session=${token}` };
}

export async function enableMarketing(clientId: string): Promise<void> {
  const adminId = await ensureBootstrapAdmin();
  await sql`INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
            VALUES (${clientId}, 'marketing', ${adminId}) ON CONFLICT (client_id, product_key) DO NOTHING`;
}

export async function grantMarketingPerms(clientId: string, levelNumber: number, keys: readonly string[]): Promise<void> {
  const perms: Record<string, true> = Object.fromEntries(keys.map((k) => [k, true]));
  await sql`UPDATE public.client_levels SET permissions = ${JSON.stringify(perms)}::jsonb WHERE client_id = ${clientId} AND level_number = ${levelNumber}`;
}

/** Seed a crm_customers row directly (audience source). last_seen controls recent_30d membership. */
export async function seedCrmCustomer(
  clientId: string, opts: { email?: string | null; lastSeen?: string; name?: string } = {},
): Promise<string> {
  const digits = `${Math.floor(1000000000 + Math.random() * 8999999999)}`;
  const key = `phone:+91${digits}`;
  const r = (await sql`
    INSERT INTO public.crm_customers (client_id, display_name, phone, email, dedupe_key, source, first_seen, last_seen)
    VALUES (${clientId}, ${opts.name ?? 'Cust'}, ${`+91${digits}`}, ${opts.email ?? null}, ${key}, 'pos', now(), ${opts.lastSeen ?? new Date().toISOString()})
    RETURNING id`) as Array<{ id: string }>;
  return r[0]!.id;
}

export function marketingRequest(ctx: MktTestCtx, method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method, headers: { cookie: ctx.cookie, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function demoteToL2(ctx: MktTestCtx): Promise<MktTestCtx> {
  await sql`INSERT INTO public.client_levels (client_id, level_number, label, permissions)
            VALUES (${ctx.clientId}::uuid, 2, 'L2', '{}'::jsonb) ON CONFLICT DO NOTHING`;
  const role = (await sql`SELECT id FROM public.client_roles WHERE client_id = ${ctx.clientId} LIMIT 1`) as Array<{ id: string }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `mkt-l2-${suffix}@exsol.test`;
  const node = (await sql`INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${ctx.clientId}, ${ctx.ownerNodeId}, 2, ${role[0]!.id}, 'L2 Sub', ${email}, ${ctx.adminId}) RETURNING id`) as Array<{ id: string }>;
  const subNodeId = node[0]!.id;
  const hash = await hashPassword('mkt-l2-pw');
  await sql`INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
            VALUES (${ctx.clientId}, ${subNodeId}, ${email}, ${hash}, false, ${ctx.adminId})`;
  const token = await mintBucketUserSession({ sub: subNodeId, email, client_id: ctx.clientId });
  return { ...ctx, ownerNodeId: subNodeId, cookie: `bu_session=${token}` };
}
