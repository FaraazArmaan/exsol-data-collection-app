import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

// In-memory Blobs mock for both the source images store and the thumbnails
// store. Mirrors the pattern in tests/integration/u-products-image.test.ts.
const sourceStore = new Map<string, ArrayBuffer>();
const thumbStore  = new Map<string, ArrayBuffer>();

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
import uProductsImageHandler from '../../netlify/functions/u-products-image';
import uProductsImageThumbHandler from '../../netlify/functions/u-products-image-thumb';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-thumb-admin@example.com';
const ADMIN_PASSWORD = 'pm-thumb-pw';

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
  const email = `pm-th-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'pm-th-pw-123';
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'Th User', email, create_login: true, temp_password: password }),
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

/** A 32×16 solid-red PNG (real bytes — sharp must be able to decode it). */
function realPngBytes(): Uint8Array {
  // 32x16 red, generated with: node -e "..." — base64 inline so the test has no fixtures dep.
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAYAAAB3AH1ZAAAAGklEQVR4nGP8z8DwnwEHYBxVOKpwVCElCgEZmwIBPgT8DwAAAABJRU5ErkJggg==';
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

async function uploadImage(productId: string, bytes: Uint8Array = realPngBytes(), mime = 'image/png'): Promise<{ id: string; blob_key: string }> {
  const fd = new FormData();
  fd.append('product_id', productId);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  fd.append('file', new Blob([ab], { type: mime }), 'img.png');
  const r = await uProductsImageHandler(new Request('http://localhost/api/u-products-image', {
    method: 'POST', headers: { cookie: buCookie }, body: fd,
  }), CTX);
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; blob_key: string };
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Th Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  sourceStore.clear();
  thumbStore.clear();
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `Th Test ${Date.now()}` }),
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

describe('u-products-image-thumb — auth + method + path', () => {
  test('405 on POST', async () => {
    const r = await uProductsImageThumbHandler(
      new Request('http://localhost/api/u-products-image-thumb/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        { method: 'POST', headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(405);
  });

  test('400 on malformed UUID', async () => {
    const r = await uProductsImageThumbHandler(
      new Request('http://localhost/api/u-products-image-thumb/not-a-uuid',
        { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(400);
  });

  test('401 without session cookie', async () => {
    const r = await uProductsImageThumbHandler(
      new Request('http://localhost/api/u-products-image-thumb/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
      CTX,
    );
    expect(r.status).toBe(401);
  });
});
