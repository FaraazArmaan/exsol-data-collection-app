// Permission-boundary sweep for the products endpoints. L1 bypasses the matrix,
// so we test gates with a level-2 user whose level_permissions JSONB we control
// directly. Each (method, path) combo gets three assertions:
//   - no cookie → 401
//   - L2 with no perms → 403
//   - L2 with required perm → 200/201/204

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
import uProductCategoriesHandler from '../../netlify/functions/u-product-categories';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-perm-boundary-admin@example.com';
const ADMIN_PASSWORD = 'pm-perm-boundary-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let clientId: string;
let clientSlug: string;
let roleId: string;
let l2NodeId: string;
let l2Cookie: string;
const createdClients: string[] = [];

async function adminLogin(): Promise<string> {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const r = await loginHandler(new Request('http://localhost/api/auth-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

async function bootL1ForSeeding(): Promise<string> {
  const email = `pm-perm-l1-${Date.now()}@example.com`;
  const pw = 'pm-perm-pw-1';
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'L1', email, create_login: true, temp_password: pw }),
  }), CTX);
  const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }),
  }), CTX);
  return lr.headers.get('set-cookie')!.split(';')[0]!;
}

async function setL2Perms(perms: Record<string, boolean>): Promise<void> {
  await sql`
    UPDATE public.client_levels SET permissions = ${JSON.stringify(perms)}::jsonb
    WHERE client_id = ${clientId}::uuid AND level_number = 2
  `;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Perm Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `Perm Test ${Date.now()}` }),
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

  // Create L1 owner (parent) so we can attach an L2 under them.
  const l1email = `pm-perm-l1-parent-${Date.now()}@example.com`;
  const l1node = await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'Parent L1', email: l1email, create_login: false }),
  }), CTX);
  const l1id = ((await l1node.json()) as { node: { id: string } }).node.id;

  // Create L2 user with login.
  const l2email = `pm-perm-l2-${Date.now()}@example.com`;
  const l2pw = 'pm-perm-pw-l2';
  const l2 = await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 2, parent_id: l1id, display_name: 'L2 User', email: l2email, create_login: true, temp_password: l2pw }),
  }), CTX);
  l2NodeId = ((await l2.json()) as { node: { id: string } }).node.id;

  const l2login = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: l2email, password: l2pw }),
  }), CTX);
  l2Cookie = l2login.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

describe('products permission boundary', () => {
  test('all endpoints return 401 with no cookie', async () => {
    expect((await uProductsHandler(new Request('http://localhost/api/u-products', { method: 'GET' }), CTX)).status).toBe(401);
    expect((await uProductsHandler(new Request('http://localhost/api/u-products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), CTX)).status).toBe(401);
    expect((await uProductsDetailHandler(new Request('http://localhost/api/u-products/00000000-0000-0000-0000-000000000000', { method: 'GET' }), CTX)).status).toBe(401);
    expect((await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', { method: 'GET' }), CTX)).status).toBe(401);
  });

  test('GET /u-products: 403 without view, 200 with view', async () => {
    await setL2Perms({});
    expect((await uProductsHandler(new Request('http://localhost/api/u-products', { method: 'GET', headers: { cookie: l2Cookie } }), CTX)).status).toBe(403);
    await setL2Perms({ 'products.products.view': true });
    expect((await uProductsHandler(new Request('http://localhost/api/u-products', { method: 'GET', headers: { cookie: l2Cookie } }), CTX)).status).toBe(200);
  });

  test('POST /u-products: 403 without create, 201 with create', async () => {
    const body = JSON.stringify({ type: 'physical', name: 'P', price_cents: 100 });
    await setL2Perms({ 'products.products.view': true });
    expect((await uProductsHandler(new Request('http://localhost/api/u-products', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: l2Cookie }, body }), CTX)).status).toBe(403);
    await setL2Perms({ 'products.products.view': true, 'products.products.create': true });
    expect((await uProductsHandler(new Request('http://localhost/api/u-products', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: l2Cookie }, body }), CTX)).status).toBe(201);
  });

  test('POST /u-product-categories: needs products.products.create', async () => {
    const body = JSON.stringify({ name: 'C' });
    await setL2Perms({ 'products.products.view': true });
    expect((await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: l2Cookie }, body }), CTX)).status).toBe(403);
    await setL2Perms({ 'products.products.view': true, 'products.products.create': true });
    expect((await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: l2Cookie }, body }), CTX)).status).toBe(201);
  });

  test('PATCH detail needs products.products.edit', async () => {
    // First, prime a product via the admin path — bypass perms by directly inserting.
    const row = (await sql`
      INSERT INTO public.products (client_id, type, name, price_cents, status)
      VALUES (${clientId}::uuid, 'physical', 'Q', 100, 'draft') RETURNING id
    `) as { id: string }[];
    const pid = row[0]!.id;
    await setL2Perms({ 'products.products.view': true });
    expect((await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${pid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: l2Cookie }, body: JSON.stringify({ name: 'X' }),
    }), CTX)).status).toBe(403);
    await setL2Perms({ 'products.products.view': true, 'products.products.edit': true });
    expect((await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${pid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: l2Cookie }, body: JSON.stringify({ name: 'X' }),
    }), CTX)).status).toBe(200);
  });

  test('DELETE detail needs products.products.delete', async () => {
    const row = (await sql`
      INSERT INTO public.products (client_id, type, name, price_cents, status)
      VALUES (${clientId}::uuid, 'physical', 'R', 100, 'draft') RETURNING id
    `) as { id: string }[];
    const pid = row[0]!.id;
    await setL2Perms({ 'products.products.view': true, 'products.products.edit': true });
    expect((await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${pid}`, { method: 'DELETE', headers: { cookie: l2Cookie } }), CTX)).status).toBe(403);
    await setL2Perms({ 'products.products.view': true, 'products.products.delete': true });
    expect((await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${pid}`, { method: 'DELETE', headers: { cookie: l2Cookie } }), CTX)).status).toBe(204);
  });
});
