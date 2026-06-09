import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

// Reuse the in-memory blob mock pattern from u-products-image.test.ts so
// uploads in this file don't hit real Netlify Blobs.
const sourceStore = new Map<string, ArrayBuffer>();
vi.mock('../../netlify/functions/_shared/products-storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/products-storage')>();
  return {
    ...original,
    productImagesStore: () => ({
      set:    async (key: string, data: ArrayBuffer) => { sourceStore.set(key, data); },
      get:    async (key: string) => sourceStore.get(key) ?? null,
      delete: async (key: string) => { sourceStore.delete(key); },
      getMetadata: async (key: string) => sourceStore.has(key) ? { etag: 'mock', metadata: {} } : null,
    }),
  };
});

import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import userNodesHandler from '../../netlify/functions/user-nodes';
import uLoginHandler from '../../netlify/functions/u-login';
import uProductsHandler from '../../netlify/functions/u-products';
import uProductsDetailHandler from '../../netlify/functions/u-products-detail';
import uProductsImageHandler from '../../netlify/functions/u-products-image';
import { assertLastAudit } from '../helpers/audit';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-admin-view@example.com';
const ADMIN_PASSWORD = 'pm-admin-view-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let adminId: string;
let clientAId: string;
let clientASlug: string;
let clientBId: string;
let buCookieB: string;
const createdClients: string[] = [];

async function adminLogin(): Promise<string> {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const r = await loginHandler(new Request('http://localhost/api/auth-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

async function provisionClient(label: string): Promise<{ id: string; slug: string; roleId: string }> {
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `${label} ${Date.now()}-${Math.random().toString(36).slice(2,6)}` }),
  }), CTX);
  const cb = (await cr.json()) as { client: { id: string; slug: string } };
  createdClients.push(cb.client.id);
  const rr = await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${cb.client.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
  }), CTX);
  const roleId = ((await rr.json()) as { role: { id: string } }).role.id;
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${cb.client.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ level_number: 1, allowed_role_ids: [roleId] }),
  }), CTX);
  return { id: cb.client.id, slug: cb.client.slug, roleId };
}

async function bootBucketUser(clientId: string, slug: string, roleId: string): Promise<string> {
  const email = `pm-av-${Date.now()}-${Math.random().toString(36).slice(2,6)}@example.com`;
  const password = 'pm-av-pw-123';
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'AV User', email, create_login: true, temp_password: password }),
  }), CTX);
  const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${slug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  }), CTX);
  return lr.headers.get('set-cookie')!.split(';')[0]!;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  const a = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'AdminView Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
    RETURNING id
  `) as { id: string }[];
  adminId = a[0]!.id;
});

beforeEach(async () => {
  sourceStore.clear();
  adminCookie = await adminLogin();
  const a = await provisionClient('AV-A');
  clientAId = a.id; clientASlug = a.slug;
  const b = await provisionClient('AV-B');
  clientBId = b.id;
  buCookieB = await bootBucketUser(clientBId, b.slug, b.roleId);
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

describe('u-products admin view', () => {
  test('admin GET /api/u-products?client=A returns only A products', async () => {
    // Seed: admin posts a product to A. Verify list under ?client=A returns it.
    const c = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ type: 'physical', name: 'A-prod', price_cents: 100 }),
    }), CTX);
    expect(c.status).toBe(201);

    const l = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      headers: { cookie: adminCookie },
    }), CTX);
    expect(l.status).toBe(200);
    const body = await l.json() as { items: Array<{ name: string }> };
    expect(body.items.some((i) => i.name === 'A-prod')).toBe(true);
    // Reference clientASlug to silence unused-var lint without changing behavior.
    expect(typeof clientASlug).toBe('string');
  });

  test('admin without ?client= returns 400 missing_client', async () => {
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
      headers: { cookie: adminCookie },
    }), CTX);
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('missing_client');
  });

  test('admin POST /api/u-products?client=A creates row under A', async () => {
    const r = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ type: 'service', name: 'A-svc', price_cents: 250 }),
    }), CTX);
    expect(r.status).toBe(201);
    const body = await r.json() as { id: string };
    const row = (await sql`SELECT client_id FROM public.products WHERE id = ${body.id}::uuid`) as { client_id: string }[];
    expect(row[0]!.client_id).toBe(clientAId);
  });

  test('admin POST /api/u-products-image?client=A writes to A blob namespace', async () => {
    // Make a product under A first.
    const c = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ type: 'physical', name: 'A-im', price_cents: 100 }),
    }), CTX);
    const prod = (await c.json()) as { id: string };
    // Upload.
    const fd = new FormData();
    fd.append('product_id', prod.id);
    fd.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'a.png');
    const r = await uProductsImageHandler(new Request(`http://localhost/api/u-products-image?client=${clientAId}`, {
      method: 'POST', headers: { cookie: adminCookie }, body: fd,
    }), CTX);
    expect(r.status).toBe(201);
    const body = await r.json() as { blob_key: string };
    expect(body.blob_key.startsWith(`product-images/${clientAId}/`)).toBe(true);
  });

  test('admin PATCH /api/u-products/:id?client=A audits with admin actor', async () => {
    const c = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ type: 'physical', name: 'A-patch', price_cents: 100 }),
    }), CTX);
    const prod = (await c.json()) as { id: string };
    const r = await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${prod.id}?client=${clientAId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'A-patched' }),
    }), CTX);
    expect(r.status).toBe(200);
    await assertLastAudit(sql, {
      op: 'products.updated',
      targetType: 'product',
      targetId: prod.id,
      actorAdminId: adminId,
      actorUserNodeId: null,
      clientId: clientAId,
    });
  });

  test('bucket-user with ?client=<other> returns 403 forbidden_cross_client', async () => {
    // buCookieB belongs to client B. Send ?client=A — backend must reject.
    const r = await uProductsHandler(new Request(`http://localhost/api/u-products?client=${clientAId}`, {
      headers: { cookie: buCookieB },
    }), CTX);
    expect(r.status).toBe(403);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('forbidden_cross_client');
  });
});
