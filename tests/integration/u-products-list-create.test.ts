import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

// In-memory Blobs mock so the hero_image_id assertions can drive a real upload.
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
import uProductsDetailHandler from '../../netlify/functions/u-products-detail';
import uProductsImageHandler from '../../netlify/functions/u-products-image';
import { assertLastAudit } from '../helpers/audit';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-products-list-admin@example.com';
const ADMIN_PASSWORD = 'pm-products-list-pw';

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
  const email = `pm-prod-l1-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'pm-prod-pw-123';
  const cr = await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      role_id: roleId, level_number: 1, parent_id: null,
      display_name: 'PM Prod Test', email,
      create_login: true, temp_password: password,
    }),
  }), CTX);
  if (cr.status !== 201) throw new Error(`createNode: ${cr.status} ${await cr.text()}`);
  const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }), CTX);
  return lr.headers.get('set-cookie')!.split(';')[0]!;
}

async function createProduct(body: Record<string, unknown>): Promise<{ id: string; status: string; name: string }> {
  const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify(body),
  }), CTX);
  if (r.status !== 201) throw new Error(`createProduct failed: ${r.status} ${await r.text()}`);
  return r.json() as Promise<{ id: string; status: string; name: string }>;
}

async function uploadImage(productId: string): Promise<{ id: string; blob_key: string }> {
  const fd = new FormData();
  fd.append('product_id', productId);
  const ab = new ArrayBuffer(3);
  new Uint8Array(ab).set([1, 2, 3]);
  fd.append('file', new Blob([ab], { type: 'image/png' }), 'img.png');
  const r = await uProductsImageHandler(new Request('http://localhost/api/u-products-image', {
    method: 'POST', headers: { cookie: buCookie },
    body: fd,
  }), CTX);
  if (r.status !== 201) throw new Error(`uploadImage failed: ${r.status} ${await r.text()}`);
  return r.json() as Promise<{ id: string; blob_key: string }>;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'PM Prod Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  blobStore.clear();
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `PM Prod Test ${Date.now()}` }),
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

describe('u-products list + create', () => {
  test('GET empty list with zero counts', async () => {
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { items: unknown[]; total: number; counts: Record<string, number> };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.counts).toEqual({ all: 0, active: 0, draft: 0, archived: 0 });
  });

  test('POST creates physical product + audit row', async () => {
    const p = await createProduct({ type: 'physical', name: 'Headphones', price_cents: 12900, sku: 'WH-1' });
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.name).toBe('Headphones');
    await assertLastAudit(sql, { op: 'products.created', targetId: p.id });
  });

  test('POST rejects legacy stock writes once Inventory is enabled', async () => {
    await sql`
      INSERT INTO public.client_enabled_products (client_id, product_key)
      VALUES (${clientId}::uuid, 'inventory')
      ON CONFLICT DO NOTHING
    `;
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ type: 'physical', name: 'Ledger-managed', price_cents: 100, stock_qty: 5 }),
    }), CTX);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: { code: 'inventory_stock_managed' } });
  });

  test('POST service product allows null sku/stock/unit', async () => {
    const p = await createProduct({ type: 'service', name: 'Repair', price_cents: 8000 });
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('POST 422 when service has stock_qty', async () => {
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ type: 'service', name: 'X', price_cents: 100, stock_qty: 5 }),
    }), CTX);
    expect(r.status).toBe(422);
  });

  test('POST 409 on duplicate SKU within client', async () => {
    await createProduct({ type: 'physical', name: 'A', price_cents: 100, sku: 'DUP-1' });
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ type: 'physical', name: 'B', price_cents: 200, sku: 'DUP-1' }),
    }), CTX);
    expect(r.status).toBe(409);
  });

  test('GET returns counts split by status', async () => {
    await createProduct({ type: 'physical', name: 'Act', price_cents: 100, status: 'active' });
    await createProduct({ type: 'physical', name: 'Draft1', price_cents: 100, status: 'draft' });
    await createProduct({ type: 'physical', name: 'Draft2', price_cents: 100, status: 'draft' });
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    const body = (await r.json()) as { items: unknown[]; counts: { all: number; active: number; draft: number; archived: number } };
    expect(body.counts).toEqual({ all: 3, active: 1, draft: 2, archived: 0 });
    expect(body.items).toHaveLength(3);
  });

  test('GET status=active filters items but keeps counts whole', async () => {
    await createProduct({ type: 'physical', name: 'Act', price_cents: 100, status: 'active' });
    await createProduct({ type: 'physical', name: 'Draft', price_cents: 100, status: 'draft' });
    const r = await uProductsHandler(new Request('http://localhost/api/u-products?status=active', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    const body = (await r.json()) as { items: Array<{ name: string }>; counts: { all: number; active: number; draft: number; archived: number } };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.name).toBe('Act');
    expect(body.counts).toEqual({ all: 2, active: 1, draft: 1, archived: 0 });
  });

  test('GET q matches name', async () => {
    await createProduct({ type: 'physical', name: 'Wireless Headphones', price_cents: 100, sku: 'WH-9', brand: 'SoundLab' });
    await createProduct({ type: 'physical', name: 'USB Hub', price_cents: 100, sku: 'USB-2', brand: 'HubCo' });
    const r = await uProductsHandler(new Request('http://localhost/api/u-products?q=headphones', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    const body = (await r.json()) as { items: Array<{ name: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.name).toBe('Wireless Headphones');
  });

  test('GET type=physical filters out services', async () => {
    await createProduct({ type: 'physical', name: 'P', price_cents: 100 });
    await createProduct({ type: 'service', name: 'S', price_cents: 100 });
    const r = await uProductsHandler(new Request('http://localhost/api/u-products?type=physical', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    const body = (await r.json()) as { items: Array<{ name: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.name).toBe('P');
  });

  test('GET pagination respects page_size', async () => {
    for (let i = 0; i < 5; i++) {
      await createProduct({ type: 'physical', name: `P${i}`, price_cents: i * 10 });
    }
    const r = await uProductsHandler(new Request('http://localhost/api/u-products?page=1&page_size=2', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    const body = (await r.json()) as { items: unknown[]; total: number; page: number; page_size: number };
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(5);
    expect(body.page).toBe(1);
    expect(body.page_size).toBe(2);
  });

  test('GET 401 without cookie', async () => {
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', { method: 'GET' }), CTX);
    expect(r.status).toBe(401);
  });

  test('POST 400 on invalid body (missing name)', async () => {
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({ type: 'physical', price_cents: 100 }),
    }), CTX);
    expect(r.status).toBe(400);
  });

  test('list returns hero_image_id for products with images', async () => {
    const p = await createProduct({ type: 'physical', name: 'With Image', price_cents: 100 });
    const img = await uploadImage(p.id);
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    const body = (await r.json()) as { items: Array<{ id: string; hero_image_id: string | null; hero_image_key: string | null }> };
    const row = body.items.find((it) => it.id === p.id);
    expect(row).toBeDefined();
    expect(row!.hero_image_id).toBe(img.id);
    expect(row!.hero_image_key).toBe(img.blob_key);
  });

  test('list returns null hero_image_id for products without images', async () => {
    const p = await createProduct({ type: 'physical', name: 'No Image', price_cents: 100 });
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    const body = (await r.json()) as { items: Array<{ id: string; hero_image_id: string | null; hero_image_key: string | null }> };
    const row = body.items.find((it) => it.id === p.id);
    expect(row).toBeDefined();
    expect(row!.hero_image_id).toBeNull();
    expect(row!.hero_image_key).toBeNull();
  });

  test('POST with discount_percent computes sale_price_cents', async () => {
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({
        type: 'physical', name: 'Discounted', price_cents: 10000,
        discount_percent: 20,
      }),
    }), CTX);
    expect(r.status).toBe(201);
    const body = await r.json() as { discount_percent: string | number | null; sale_price_cents: number | null };
    expect(Number(body.discount_percent)).toBe(20);
    expect(body.sale_price_cents).toBe(8000);
  });

  test('POST with discount_percent + sale_price_cents silently overrides sale_price', async () => {
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({
        type: 'physical', name: 'Discounted-Override', price_cents: 10000,
        discount_percent: 20, sale_price_cents: 9999,
      }),
    }), CTX);
    expect(r.status).toBe(201);
    const body = await r.json() as { sale_price_cents: number | null };
    expect(body.sale_price_cents).toBe(8000); // computed wins
  });

  test('POST rejects discount_percent = 100', async () => {
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({
        type: 'physical', name: 'Bad', price_cents: 10000, discount_percent: 100,
      }),
    }), CTX);
    // parseCreateProduct rejects discount_percent >= 100 → 422 invalid_input
    expect(r.status).toBe(422);
  });

  test('CREATE+GET round-trip persists Phase B fields', async () => {
    const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
      body: JSON.stringify({
        type: 'physical', name: 'Egg', price_cents: 200,
        gtin: '0123456789012', condition: 'new', availability: 'in_stock',
        weight_grams: 50, color: 'white', country_of_origin: 'IN',
        hsn_code: '0407', gst_rate: 5,
      }),
    }), CTX);
    expect(r.status).toBe(201);
    const created = await r.json() as { id: string };
    const gr = await uProductsDetailHandler(new Request(`http://localhost/api/u-products-detail/${created.id}`, {
      headers: { cookie: buCookie },
    }), CTX);
    expect(gr.status).toBe(200);
    const fetched = await gr.json() as Record<string, unknown>;
    expect(fetched.gtin).toBe('0123456789012');
    expect(fetched.condition).toBe('new');
    expect(fetched.availability).toBe('in_stock');
    expect(fetched.weight_grams).toBe(50);
    expect(fetched.color).toBe('white');
    expect(fetched.country_of_origin).toBe('IN');
    expect(fetched.hsn_code).toBe('0407');
    // numeric(5,2) returns as string from the Neon driver.
    expect(fetched.gst_rate).toBe('5.00');
  });
});
