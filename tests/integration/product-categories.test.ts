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
import uProductCategoriesHandler from '../../netlify/functions/u-product-categories';
import { assertLastAudit } from '../helpers/audit';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-categories-admin@example.com';
const ADMIN_PASSWORD = 'pm-categories-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let clientId: string;
let clientSlug: string;
let roleId: string;
let primaryBuCookie: string;
const createdClients: string[] = [];

async function adminLogin(): Promise<string> {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const r = await loginHandler(new Request('http://localhost/api/auth-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

async function createBucketUserLogin(email: string, password: string, levelNumber = 1): Promise<string> {
  const create = await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      role_id: roleId, level_number: levelNumber, parent_id: null,
      display_name: 'PM Cat Test', email,
      create_login: true, temp_password: password,
    }),
  }), CTX);
  if (create.status !== 201) throw new Error(`createNode failed: ${create.status} ${await create.text()}`);

  const login = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }), CTX);
  return login.headers.get('set-cookie')!.split(';')[0]!;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'PM Cat Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `PM Cat Test ${Date.now()}` }),
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
    body: JSON.stringify({ level_number: 1 }),
  }), CTX);

  // L1 bucket user — bypasses the permission matrix automatically.
  primaryBuCookie = await createBucketUserLogin(`pm-cat-l1-${Date.now()}@example.com`, 'pm-cat-pw-123');
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

describe('u-product-categories', () => {
  test('GET returns empty list for a fresh client', async () => {
    const r = await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', {
      method: 'GET', headers: { cookie: primaryBuCookie },
    }), CTX);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  test('POST creates a category and writes audit', async () => {
    const r = await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: primaryBuCookie },
      body: JSON.stringify({ name: 'Electronics' }),
    }), CTX);
    expect(r.status).toBe(201);
    const cat = (await r.json()) as { id: string; name: string };
    expect(cat.name).toBe('Electronics');
    expect(cat.id).toMatch(/^[0-9a-f-]{36}$/);
    await assertLastAudit(sql, { op: 'product_categories.created', targetId: cat.id });
  });

  test('POST duplicate name → 409', async () => {
    await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: primaryBuCookie },
      body: JSON.stringify({ name: 'Dup' }),
    }), CTX);
    const r = await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: primaryBuCookie },
      body: JSON.stringify({ name: 'Dup' }),
    }), CTX);
    expect(r.status).toBe(409);
  });

  test('PATCH renames a category', async () => {
    const create = await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: primaryBuCookie },
      body: JSON.stringify({ name: 'OldName' }),
    }), CTX);
    const cat = (await create.json()) as { id: string };
    const r = await uProductCategoriesHandler(new Request(`http://localhost/api/u-product-categories/${cat.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: primaryBuCookie },
      body: JSON.stringify({ name: 'NewName' }),
    }), CTX);
    expect(r.status).toBe(200);
    const updated = (await r.json()) as { name: string };
    expect(updated.name).toBe('NewName');
  });

  test('DELETE soft-deletes and nulls products.category_id', async () => {
    const create = await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: primaryBuCookie },
      body: JSON.stringify({ name: 'ToDelete' }),
    }), CTX);
    const cat = (await create.json()) as { id: string };

    // Insert a product referencing the category (direct DB — products endpoint not built yet for this test).
    const productRows = (await sql`
      INSERT INTO public.products (client_id, type, name, price_cents, category_id, status)
      VALUES (${clientId}::uuid, 'physical', 'P', 100, ${cat.id}::uuid, 'draft')
      RETURNING id
    `) as { id: string }[];
    const productId = productRows[0]!.id;

    const r = await uProductCategoriesHandler(new Request(`http://localhost/api/u-product-categories/${cat.id}`, {
      method: 'DELETE', headers: { cookie: primaryBuCookie },
    }), CTX);
    expect(r.status).toBe(204);

    const deleted = (await sql`SELECT deleted_at FROM public.product_categories WHERE id = ${cat.id}::uuid`) as { deleted_at: string | null }[];
    expect(deleted[0]!.deleted_at).not.toBeNull();

    const product = (await sql`SELECT category_id FROM public.products WHERE id = ${productId}::uuid`) as { category_id: string | null }[];
    expect(product[0]!.category_id).toBeNull();

    await assertLastAudit(sql, { op: 'product_categories.deleted', targetId: cat.id });
  });

  test('GET 401 without cookie', async () => {
    const r = await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', { method: 'GET' }), CTX);
    expect(r.status).toBe(401);
  });

  test('POST 400 on invalid body', async () => {
    const r = await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: primaryBuCookie },
      body: JSON.stringify({ name: '' }),
    }), CTX);
    expect(r.status).toBe(400);
  });
});
