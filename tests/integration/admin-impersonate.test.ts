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

const CTX = {} as Context;
const ADMIN_EMAIL = `imp-admin-${Date.now()}@example.com`;
const ADMIN_PASSWORD = 'imp-admin-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let clientId: string;
let clientSlug: string;
let ownerNodeId: string;
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
  const roleId = ((await rr.json()) as { role: { id: string } }).role.id;
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ level_number: 1, allowed_role_ids: [roleId] }),
  }), CTX);
  const email = `imp-owner-${Date.now()}@example.com`;
  const un = await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'Owner', email, create_login: true, temp_password: 'imp-owner-pw-1' }),
  }), CTX);
  ownerNodeId = ((await un.json()) as { node: { id: string } }).node.id;
});

afterAll(async () => {
  for (const id of createdClients) await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`;
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
    const r = await impersonate(adminCookie, { clientId });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { slug: string };
    expect(body.slug).toBe(clientSlug);

    // The Set-Cookie is a valid bu_session whose subject is the client's Owner node.
    const setCookie = r.headers.get('set-cookie')!;
    expect(setCookie).toContain('bu_session=');
    const token = setCookie.split('bu_session=')[1]!.split(';')[0]!;
    const claims = await verifyBucketUserSession(token);
    expect(claims.sub).toBe(ownerNodeId);
    expect(claims.client_id).toBe(clientId);
    expect(claims.kind).toBe('bucket_user');
  });

  test('audit-logs the impersonation (op admin.impersonate)', async () => {
    await impersonate(adminCookie, { clientId });
    const rows = (await sql`
      SELECT op FROM public.audit_log WHERE op = 'admin.impersonate' AND client_id = ${clientId}::uuid LIMIT 1
    `) as { op: string }[];
    expect(rows.length).toBe(1);
  });

  test('404 for an unknown client', async () => {
    const r = await impersonate(adminCookie, { clientId: '00000000-0000-0000-0000-000000000000' });
    expect(r.status).toBe(404);
  });
});
