// Integration-test helpers for the CRM module.
//
// seedClientWithCrm() mints a fresh Client + L1 Owner (+ credential + JWT cookie)
// so CRM endpoints can authenticate. Seed shape mirrors tests/booking/_helpers.ts.
// Customer nodes need a bucket_family='customers' role (seedCustomerRole).
//
// Requires DATABASE_URL with migrations 055 applied.

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
  const hash = await hashPassword('crm-test-admin-pw');
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES ('crm-test-admin@exsol.test', ${hash}, 'CRM Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash} RETURNING id
  `) as Array<{ id: string }>;
  cachedAdminId = rows[0]!.id;
  return cachedAdminId;
}

export interface CrmTestCtx { clientId: string; ownerNodeId: string; adminId: string; slug: string; cookie: string; }

export async function seedClientWithCrm(): Promise<CrmTestCtx> {
  const adminId = await ensureBootstrapAdmin();
  const slug = `crm-test-${Math.random().toString(36).slice(2, 10)}`;
  const c = (await sql`INSERT INTO public.clients (slug, name, created_by) VALUES (${slug}, 'CRM Test', ${adminId}) RETURNING id`) as Array<{ id: string }>;
  const clientId = c[0]!.id;
  const role = (await sql`INSERT INTO public.client_roles (client_id, key, label, color) VALUES (${clientId}, 'owner', 'Owner', '#3b82f6') RETURNING id`) as Array<{ id: string }>;
  await sql`INSERT INTO public.client_levels (client_id, level_number, label, permissions) VALUES (${clientId}, 1, 'Primary', '{}'::jsonb)`;
  const email = `crm-owner-${slug}@exsol.test`;
  const node = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientId}, NULL, 1, ${role[0]!.id}, 'CRM Test Owner', ${email}, ${adminId}) RETURNING id`) as Array<{ id: string }>;
  const ownerNodeId = node[0]!.id;
  const hash = await hashPassword('crm-owner-pw');
  await sql`INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
            VALUES (${clientId}, ${ownerNodeId}, ${email}, ${hash}, false, ${adminId})`;
  const token = await mintBucketUserSession({ sub: ownerNodeId, email, client_id: clientId });
  return { clientId, ownerNodeId, adminId, slug, cookie: `bu_session=${token}` };
}

export async function enableCrm(clientId: string): Promise<void> {
  const adminId = await ensureBootstrapAdmin();
  await sql`INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
            VALUES (${clientId}, 'crm', ${adminId}) ON CONFLICT (client_id, product_key) DO NOTHING`;
}

export async function seedCustomerRole(clientId: string): Promise<string> {
  const r = (await sql`INSERT INTO public.client_roles (client_id, key, label, color, bucket_family)
    VALUES (${clientId}, 'customer', 'Customer', '#10b981', 'customers') RETURNING id`) as Array<{ id: string }>;
  return r[0]!.id;
}

/** Insert a customer user_node directly (simulates a booking-created customer). */
export async function seedCustomerNode(clientId: string, roleId: string, name: string, phone: string | null, email: string | null): Promise<string> {
  const r = (await sql`INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, phone)
    VALUES (${clientId}, NULL, NULL, ${roleId}, ${name}, ${email}, ${phone}) RETURNING id`) as Array<{ id: string }>;
  return r[0]!.id;
}

export function crmRequest(ctx: CrmTestCtx, method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method, headers: { cookie: ctx.cookie, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// Seed a fresh L2 subordinate user_node under the existing L1 Owner + mint a
// new bucket-user session. Returns a ctx whose cookie carries the L2 sub so
// strict matrix-perm tests fire the perm check.
export async function demoteToL2(ctx: CrmTestCtx): Promise<CrmTestCtx> {
  await sql`INSERT INTO public.client_levels (client_id, level_number, label, permissions)
            VALUES (${ctx.clientId}::uuid, 2, 'L2', '{}'::jsonb) ON CONFLICT DO NOTHING`;
  const role = (await sql`SELECT id FROM public.client_roles WHERE client_id = ${ctx.clientId} LIMIT 1`) as Array<{ id: string }>;
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `crm-l2-${suffix}@exsol.test`;
  const node = (await sql`INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${ctx.clientId}, ${ctx.ownerNodeId}, 2, ${role[0]!.id}, 'L2 Sub', ${email}, ${ctx.adminId}) RETURNING id`) as Array<{ id: string }>;
  const subNodeId = node[0]!.id;
  const hash = await hashPassword('crm-l2-pw');
  await sql`INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
            VALUES (${ctx.clientId}, ${subNodeId}, ${email}, ${hash}, false, ${ctx.adminId})`;
  const token = await mintBucketUserSession({ sub: subNodeId, email, client_id: ctx.clientId });
  return { ...ctx, ownerNodeId: subNodeId, cookie: `bu_session=${token}` };
}
