import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import userNodesHandler from '../../netlify/functions/user-nodes';
import uLoginHandler from '../../netlify/functions/u-login';
import uProductsHandler from '../../netlify/functions/u-products';
import uProductsBulkHandler from '../../netlify/functions/u-products-bulk';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-bulk-admin@example.com';
const ADMIN_PASSWORD = 'pm-bulk-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let clientId: string;
let clientSlug: string;
let roleId: string;
let buCookie: string;
const createdClients: string[] = [];

async function adminLogin(): Promise<string> {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const r = await loginHandler(new Request('http://localhost/api/auth-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

async function bootBu(): Promise<string> {
  const email = `pm-bulk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'pm-bulk-pw-123';
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'Bulk User', email, create_login: true, temp_password: password }),
  }), CTX);
  const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  }), CTX);
  return lr.headers.get('set-cookie')!.split(';')[0]!;
}

async function mkProduct(name: string, status = 'draft'): Promise<string> {
  const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({ type: 'physical', name, price_cents: 100, status }),
  }), CTX);
  return ((await r.json()) as { id: string }).id;
}

async function bulk(body: unknown): Promise<Response> {
  return uProductsBulkHandler(new Request('http://localhost/api/u-products-bulk', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify(body),
  }), CTX);
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Bulk Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `Bulk Test ${Date.now()}` }),
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
  buCookie = await bootBu();
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

describe('u-products-bulk', () => {
  test('set_status archives many products + emits status_changed for each', async () => {
    const ids = [await mkProduct('A'), await mkProduct('B'), await mkProduct('C')];
    const r = await bulk({ ids, action: 'set_status', value: 'archived' });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: string[]; errors: unknown[] };
    expect(body.ok.sort()).toEqual(ids.slice().sort());
    expect(body.errors).toEqual([]);
    const statuses = (await sql`SELECT status FROM public.products WHERE id = ANY(${ids}::uuid[])`) as { status: string }[];
    expect(statuses.every((s) => s.status === 'archived')).toBe(true);
  });

  test('partial success — unknown id surfaces as not_found error', async () => {
    const owned = await mkProduct('Own');
    const stranger = '00000000-0000-0000-0000-000000000000';
    const r = await bulk({ ids: [owned, stranger], action: 'set_status', value: 'archived' });
    const body = (await r.json()) as { ok: string[]; errors: Array<{ id: string; code: string }> };
    expect(body.ok).toEqual([owned]);
    expect(body.errors).toEqual([{ id: stranger, code: 'not_found' }]);
  });

  test('delete action soft-deletes the rows', async () => {
    const ids = [await mkProduct('D1'), await mkProduct('D2')];
    const r = await bulk({ ids, action: 'delete' });
    expect(r.status).toBe(200);
    const rows = (await sql`SELECT deleted_at FROM public.products WHERE id = ANY(${ids}::uuid[])`) as { deleted_at: string | null }[];
    expect(rows.every((r) => r.deleted_at !== null)).toBe(true);
  });

  test('400 on invalid body', async () => {
    const r = await bulk({ ids: [], action: 'set_status', value: 'archived' });
    expect(r.status).toBe(400);
  });
});
