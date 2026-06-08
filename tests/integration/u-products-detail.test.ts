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
import uProductsDetailHandler from '../../netlify/functions/u-products-detail';
import { assertLastAudit } from '../helpers/audit';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-products-detail-admin@example.com';
const ADMIN_PASSWORD = 'pm-products-detail-pw';

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

async function bootBucketUser(): Promise<string> {
  const email = `pm-detail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'pm-detail-pw-123';
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      role_id: roleId, level_number: 1, parent_id: null,
      display_name: 'Detail User', email,
      create_login: true, temp_password: password,
    }),
  }), CTX);
  const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }), CTX);
  return lr.headers.get('set-cookie')!.split(';')[0]!;
}

async function makeProduct(body: Record<string, unknown>): Promise<{ id: string; status: string; name: string }> {
  const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify(body),
  }), CTX);
  return r.json() as Promise<{ id: string; status: string; name: string }>;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'PM Detail Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `PM Detail Test ${Date.now()}` }),
  }), CTX);
  const cb = (await cr.json()) as { client: { id: string; slug: string } };
  clientId = cb.client.id;
  clientSlug = cb.client.slug;
  createdClients.push(clientId);
  const rr = await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
  }), CTX);
  roleId = ((await rr.json()) as { role: { id: string } }).role.id;
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ level_number: 1, allowed_role_ids: [roleId] }),
  }), CTX);
  buCookie = await bootBucketUser();
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

describe('u-products-detail', () => {
  test('GET returns product with empty images array', async () => {
    const p = await makeProduct({ type: 'physical', name: 'X', price_cents: 100 });
    const r = await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${p.id}`, { method: 'GET', headers: { cookie: buCookie } }), CTX);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { id: string; images: unknown[] };
    expect(body.id).toBe(p.id);
    expect(body.images).toEqual([]);
  });

  test('GET 404 for non-existent id', async () => {
    const r = await uProductsDetailHandler(new Request('http://localhost/api/u-products/00000000-0000-0000-0000-000000000000', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    expect(r.status).toBe(404);
  });

  test('PATCH renames + emits products.updated audit', async () => {
    const p = await makeProduct({ type: 'physical', name: 'Old', price_cents: 100 });
    const r = await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ name: 'New' }),
    }), CTX);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { name: string }).name).toBe('New');
    await assertLastAudit(sql, { op: 'products.updated', targetId: p.id });
  });

  test('PATCH status change emits products.status_changed', async () => {
    const p = await makeProduct({ type: 'physical', name: 'S', price_cents: 100, status: 'draft' });
    const r = await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ status: 'active' }),
    }), CTX);
    expect(r.status).toBe(200);
    await assertLastAudit(sql, { op: 'products.status_changed', targetId: p.id });
  });

  test('PATCH 422 when service receives stock_qty', async () => {
    const p = await makeProduct({ type: 'service', name: 'Svc', price_cents: 100 });
    const r = await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ stock_qty: 5 }),
    }), CTX);
    expect(r.status).toBe(422);
  });

  test('PATCH 409 on SKU collision with another product', async () => {
    await makeProduct({ type: 'physical', name: 'A', price_cents: 100, sku: 'TAKEN-1' });
    const b = await makeProduct({ type: 'physical', name: 'B', price_cents: 100, sku: 'FREE-1' });
    const r = await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${b.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ sku: 'TAKEN-1' }),
    }), CTX);
    expect(r.status).toBe(409);
  });

  test('DELETE soft-deletes + emits products.archived', async () => {
    const p = await makeProduct({ type: 'physical', name: 'D', price_cents: 100 });
    const r = await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${p.id}`, {
      method: 'DELETE', headers: { cookie: buCookie },
    }), CTX);
    expect(r.status).toBe(204);
    const row = (await sql`SELECT deleted_at FROM public.products WHERE id = ${p.id}::uuid`) as { deleted_at: string | null }[];
    expect(row[0]!.deleted_at).not.toBeNull();
    await assertLastAudit(sql, { op: 'products.archived', targetId: p.id });
  });

  test('GET 401 without cookie', async () => {
    const p = await makeProduct({ type: 'physical', name: 'Z', price_cents: 100 });
    const r = await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${p.id}`, { method: 'GET' }), CTX);
    expect(r.status).toBe(401);
  });
});
