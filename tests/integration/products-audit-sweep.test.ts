// End-to-end sweep that exercises every products-module audit op in a single
// lifecycle, then asserts the full op set landed in audit_log.

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

const blobStore = new Map<string, ArrayBuffer>();
vi.mock('../../netlify/functions/_shared/products-storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/products-storage')>();
  return {
    ...original,
    productImagesStore: () => ({
      set:    async (k: string, d: ArrayBuffer) => { blobStore.set(k, d); },
      get:    async (k: string) => blobStore.get(k) ?? null,
      delete: async (k: string) => { blobStore.delete(k); },
      getMetadata: async (k: string) => blobStore.has(k) ? { etag: 'm', metadata: {} } : null,
    }),
  };
});

const thumbStore = new Map<string, ArrayBuffer>();
vi.mock('../../netlify/functions/_shared/products-thumbnails', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/products-thumbnails')>();
  return {
    ...original,
    productThumbnailsStore: () => ({
      set:    async (key: string, data: ArrayBuffer) => { thumbStore.set(key, data); },
      get:    async (key: string) => thumbStore.get(key) ?? null,
      delete: async (key: string) => { thumbStore.delete(key); },
      getMetadata: async (key: string) => thumbStore.has(key) ? { etag: 'mock', metadata: {} } : null,
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
import uProductCategoriesHandler from '../../netlify/functions/u-product-categories';
import uProductsImageHandler from '../../netlify/functions/u-products-image';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-audit-sweep-admin@example.com';
const ADMIN_PASSWORD = 'pm-audit-sweep-pw';

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

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Audit Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  blobStore.clear();
  thumbStore.clear();
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `Audit Sweep ${Date.now()}` }),
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
  const email = `pm-audit-${Date.now()}@example.com`;
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'Audit', email, create_login: true, temp_password: 'pm-audit-pw-1' }),
  }), CTX);
  const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pm-audit-pw-1' }),
  }), CTX);
  buCookie = lr.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

describe('products audit sweep', () => {
  test('lifecycle emits the full expected audit op set', async () => {
    // category
    const cat = (await (await uProductCategoriesHandler(new Request('http://localhost/api/u-product-categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ name: 'Cat' }),
    }), CTX)).json()) as { id: string };
    // product
    const p = (await (await uProductsHandler(new Request('http://localhost/api/u-products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ type: 'physical', name: 'P', price_cents: 100, status: 'draft' }),
    }), CTX)).json()) as { id: string };
    // update name
    await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ name: 'P2' }),
    }), CTX);
    // status change
    await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ status: 'active' }),
    }), CTX);
    // category change
    await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ category_id: cat.id }),
    }), CTX);
    // image add
    const fd = new FormData();
    fd.append('product_id', p.id);
    const ab = new ArrayBuffer(3); new Uint8Array(ab).set([1, 2, 3]);
    fd.append('file', new Blob([ab], { type: 'image/png' }), 'i.png');
    const imgRes = await uProductsImageHandler(new Request('http://localhost/api/u-products-image', {
      method: 'POST', headers: { cookie: buCookie }, body: fd,
    }), CTX);
    const img = (await imgRes.json()) as { id: string };
    // image delete
    await uProductsImageHandler(new Request(`http://localhost/api/u-products-image/${img.id}`, {
      method: 'DELETE', headers: { cookie: buCookie },
    }), CTX);
    // archive product
    await uProductsDetailHandler(new Request(`http://localhost/api/u-products/${p.id}`, {
      method: 'DELETE', headers: { cookie: buCookie },
    }), CTX);
    // category soft-delete
    await uProductCategoriesHandler(new Request(`http://localhost/api/u-product-categories/${cat.id}`, {
      method: 'DELETE', headers: { cookie: buCookie },
    }), CTX);

    const ops = ((await sql`
      SELECT op FROM public.audit_log
      WHERE client_id = ${clientId}::uuid AND op LIKE 'product%'
      ORDER BY occurred_at ASC
    `) as { op: string }[]).map((r) => r.op);

    expect(ops).toEqual(expect.arrayContaining([
      'product_categories.created',
      'products.created',
      'products.updated',
      'products.status_changed',
      'products.category_changed',
      'products.image_added',
      'products.image_deleted',
      'products.archived',
      'product_categories.deleted',
    ]));
  });
});
