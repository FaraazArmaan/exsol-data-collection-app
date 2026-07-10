// Admin "view as client" impersonation: admin-gated, mints an Owner (bucket-user)
// session for the client, and audit-logs the entry.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import { verifyBucketUserSession } from '../../netlify/functions/_shared/session';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import userNodesHandler from '../../netlify/functions/user-nodes';
import impersonateHandler from '../../netlify/functions/admin-impersonate';
import uProductsHandler from '../../netlify/functions/u-products';
import uMeHandler from '../../netlify/functions/u-me';

const CTX = {} as Context;
const ADMIN_EMAIL = `imp-admin-${Date.now()}@example.com`;
const ADMIN_PASSWORD = 'imp-admin-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let clientId: string;
let clientSlug: string;
let ownerNodeId: string;
let childNodeId: string;
let roleId: string;
const createdClients: string[] = [];

async function adminLogin(): Promise<string> {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const r = await loginHandler(new Request('http://localhost/api/auth-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Imp Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
  adminCookie = await adminLogin();

  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `Imp Client ${Date.now()}` }),
  }), CTX);
  const cb = (await cr.json()) as { client: { id: string; slug: string } };
  clientId = cb.client.id; clientSlug = cb.client.slug; createdClients.push(clientId);

  const rr = await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
  }), CTX);
  roleId = ((await rr.json()) as { role: { id: string } }).role.id;
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ level_number: 1, allowed_role_ids: [roleId] }),
  }), CTX);
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ level_number: 2, allowed_role_ids: [roleId] }),
  }), CTX);
  const email = `imp-owner-${Date.now()}@example.com`;
  const un = await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'Owner', email, create_login: true, temp_password: 'imp-owner-pw-1' }),
  }), CTX);
  ownerNodeId = ((await un.json()) as { node: { id: string } }).node.id;
  const child = await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 2, parent_id: ownerNodeId, display_name: 'No Login Child', email: `no-login-${Date.now()}@example.com` }),
  }), CTX);
  childNodeId = ((await child.json()) as { node: { id: string } }).node.id;
});

afterAll(async () => {
  for (const id of createdClients) {
    await sql`DELETE FROM public.audit_log WHERE client_id = ${id}::uuid`;
    await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`;
  }
});

function impersonate(cookie: string | null, body: unknown) {
  return impersonateHandler(new Request('http://localhost/api/admin-impersonate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }), CTX);
}

describe('admin-impersonate — view as client', () => {
  test('401 without an admin session', async () => {
    const r = await impersonate(null, { clientId });
    expect(r.status).toBe(401);
  });

  test('mints an Owner bucket-user session + returns the slug', async () => {
    const r = await impersonate(adminCookie, { clientId, reason: 'support investigation' });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { slug: string; impersonation_started_at: string };
    expect(body.slug).toBe(clientSlug);
    expect(body.impersonation_started_at).toBeTruthy();

    // The Set-Cookie is a valid bu_session whose subject is the client's Owner node.
    const setCookie = r.headers.get('set-cookie')!;
    expect(setCookie).toContain('bu_session=');
    expect(setCookie).toContain('Max-Age=3600');
    const token = setCookie.split('bu_session=')[1]!.split(';')[0]!;
    const claims = await verifyBucketUserSession(token);
    expect(claims.sub).toBe(ownerNodeId);
    expect(claims.client_id).toBe(clientId);
    expect(claims.kind).toBe('bucket_user');
    expect(claims.impersonated_by_admin).toBeTruthy();
    expect(claims.impersonation_reason).toBe('support investigation');

    const rows = (await sql`
      SELECT impersonated_by_admin, impersonation_reason
      FROM public.auth_sessions
      WHERE id = ${claims.jti}::uuid
      LIMIT 1
    `) as { impersonated_by_admin: string | null; impersonation_reason: string | null }[];
    expect(rows[0]!.impersonated_by_admin).toBe(claims.impersonated_by_admin);
    expect(rows[0]!.impersonation_reason).toBe('support investigation');
  });

  test('can impersonate a selected user node without login credentials', async () => {
    const r = await impersonate(adminCookie, {
      clientId,
      userNodeId: childNodeId,
      reason: 'support investigation as selected user',
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { slug: string; mode: string; as_display_name: string };
    expect(body.slug).toBe(clientSlug);
    expect(body.mode).toBe('user');
    expect(body.as_display_name).toBe('No Login Child');

    const setCookie = r.headers.get('set-cookie')!.split(';')[0]!;
    const token = setCookie.split('bu_session=')[1]!;
    const claims = await verifyBucketUserSession(token);
    expect(claims.sub).toBe(childNodeId);

    const me = await uMeHandler(new Request('http://localhost/api/u-me', {
      method: 'GET',
      headers: { cookie: `${adminCookie}; ${setCookie}` },
    }), CTX);
    expect(me.status).toBe(200);
    const meBody = await me.json() as { user: { id: string; display_name: string; level_number: number } };
    expect(meBody.user.id).toBe(childNodeId);
    expect(meBody.user.display_name).toBe('No Login Child');
    expect(meBody.user.level_number).toBe(2);
  });

  test('audit-logs the impersonation (op admin.impersonate)', async () => {
    await impersonate(adminCookie, { clientId, reason: 'support investigation' });
    const rows = (await sql`
      SELECT op, detail
      FROM public.audit_log
      WHERE op = 'admin.impersonate'
        AND client_id = ${clientId}::uuid
        AND detail->>'reason' = 'support investigation'
      ORDER BY occurred_at DESC
      LIMIT 1
    `) as { op: string; detail: { mode?: string; reason?: string } }[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.detail.mode).toBe('admin_full_access');
    expect(rows[0]!.detail.reason).toBe('support investigation');
  });

  test('downstream impersonated writes audit both the Owner node and initiating admin', async () => {
    const imp = await impersonate(adminCookie, { clientId, reason: 'create product on behalf of client' });
    const setCookie = imp.headers.get('set-cookie')!.split(';')[0]!;
    const token = setCookie.split('bu_session=')[1]!;
    const claims = await verifyBucketUserSession(token);

    const create = await uProductsHandler(new Request('http://localhost/api/u-products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: `${adminCookie}; ${setCookie}` },
      body: JSON.stringify({
        type: 'physical',
        name: `Impersonated Product ${Date.now()}`,
        price_cents: 1299,
        sku: `IMP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        stock_qty: 3,
        unit: 'pcs',
      }),
    }), CTX);
    expect(create.status).toBe(201);
    const product = await create.json() as { id: string };

    const rows = (await sql`
      SELECT actor_admin, actor_user_node, impersonated_by_admin
      FROM public.audit_log
      WHERE op = 'products.created'
        AND target_id = ${product.id}
      LIMIT 1
    `) as { actor_admin: string | null; actor_user_node: string | null; impersonated_by_admin: string | null }[];
    expect(rows[0]!.actor_admin).toBeNull();
    expect(rows[0]!.actor_user_node).toBe(ownerNodeId);
    expect(rows[0]!.impersonated_by_admin).toBe(claims.impersonated_by_admin);
  });

  test('404 for an unknown client', async () => {
    const r = await impersonate(adminCookie, {
      clientId: '00000000-0000-0000-0000-000000000000',
      reason: 'support investigation',
    });
    expect(r.status).toBe(404);
  });

  test('400 when reason is missing', async () => {
    const r = await impersonate(adminCookie, { clientId });
    expect(r.status).toBe(400);
  });
});
