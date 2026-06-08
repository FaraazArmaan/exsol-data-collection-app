import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

// In-memory Blobs mock — mirrors the pattern in files-detail.test.ts.
const blobStore = new Map<string, ArrayBuffer>();
vi.mock('../../netlify/functions/_shared/products-storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/products-storage')>();
  return {
    ...original,
    productImagesStore: () => ({
      set:    async (key: string, data: ArrayBuffer) => { blobStore.set(key, data); },
      get:    async (key: string) => blobStore.get(key) ?? null,
      delete: async (key: string) => { blobStore.delete(key); },
      getMetadata: async (key: string) => blobStore.has(key) ? { etag: 'mock', metadata: {} } : null,
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
import uProductsImageHandler from '../../netlify/functions/u-products-image';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-image-admin@example.com';
const ADMIN_PASSWORD = 'pm-image-pw';

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
  const email = `pm-img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'pm-img-pw-123';
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'Img User', email, create_login: true, temp_password: password }),
  }), CTX);
  const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  }), CTX);
  return lr.headers.get('set-cookie')!.split(';')[0]!;
}

async function makeProduct(): Promise<{ id: string }> {
  const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({ type: 'physical', name: `P-${Date.now()}`, price_cents: 100 }),
  }), CTX);
  return r.json() as Promise<{ id: string }>;
}

async function uploadImage(productId: string, bytes: Uint8Array = new Uint8Array([1, 2, 3]), mime = 'image/png'): Promise<Response> {
  const fd = new FormData();
  fd.append('product_id', productId);
  // Copy to plain ArrayBuffer to keep TS happy across SharedArrayBuffer overload.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  fd.append('file', new Blob([ab], { type: mime }), 'img.png');
  return uProductsImageHandler(new Request('http://localhost/api/u-products-image', {
    method: 'POST', headers: { cookie: buCookie },
    body: fd,
  }), CTX);
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Img Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  blobStore.clear();
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `Img Test ${Date.now()}` }),
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
  buCookie = await bootBucketUser();
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

describe('u-products-image', () => {
  test('POST uploads image, inserts row, sets hero on first image', async () => {
    const p = await makeProduct();
    const r = await uploadImage(p.id);
    expect(r.status).toBe(201);
    const img = (await r.json()) as { id: string; blob_key: string; sort_order: number };
    expect(img.sort_order).toBe(0);

    const heroRow = (await sql`SELECT hero_image_key FROM public.products WHERE id = ${p.id}::uuid`) as { hero_image_key: string | null }[];
    expect(heroRow[0]!.hero_image_key).toBe(img.blob_key);
  });

  test('POST 400 on unsupported mime', async () => {
    const p = await makeProduct();
    const r = await uploadImage(p.id, new Uint8Array([1]), 'application/pdf');
    expect(r.status).toBe(400);
  });

  test('POST 422 when 20-image cap reached', async () => {
    const p = await makeProduct();
    for (let i = 0; i < 20; i++) {
      await sql`INSERT INTO public.product_images (product_id, blob_key, sort_order) VALUES (${p.id}::uuid, ${'k' + i}, ${i})`;
    }
    const r = await uploadImage(p.id);
    expect(r.status).toBe(422);
  });

  test('DELETE removes row + blob, rotates hero to next image', async () => {
    const p = await makeProduct();
    const first = (await (await uploadImage(p.id)).json()) as { id: string; blob_key: string };
    const second = (await (await uploadImage(p.id)).json()) as { id: string; blob_key: string };
    // Hero is currently `first.blob_key` (was set on first upload).
    const heroBefore = (await sql`SELECT hero_image_key FROM public.products WHERE id = ${p.id}::uuid`) as { hero_image_key: string }[];
    expect(heroBefore[0]!.hero_image_key).toBe(first.blob_key);

    const r = await uProductsImageHandler(new Request(`http://localhost/api/u-products-image/${first.id}`, {
      method: 'DELETE', headers: { cookie: buCookie },
    }), CTX);
    expect(r.status).toBe(204);

    const heroAfter = (await sql`SELECT hero_image_key FROM public.products WHERE id = ${p.id}::uuid`) as { hero_image_key: string }[];
    expect(heroAfter[0]!.hero_image_key).toBe(second.blob_key);
    expect(blobStore.has(first.blob_key)).toBe(false);
  });

  test('POST 404 for product belonging to another client', async () => {
    // Create a stray client via the admin endpoint so we get a valid row.
    const otherCr = await clientsHandler(new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: `Other Client ${Date.now()}` }),
    }), CTX);
    const otherCb = (await otherCr.json()) as { client: { id: string } };
    createdClients.push(otherCb.client.id);
    const otherProduct = (await sql`
      INSERT INTO public.products (client_id, type, name, price_cents)
      VALUES (${otherCb.client.id}::uuid, 'physical', 'Foreign', 100) RETURNING id
    `) as { id: string }[];
    const r = await uploadImage(otherProduct[0]!.id);
    expect(r.status).toBe(404);
  });
});
