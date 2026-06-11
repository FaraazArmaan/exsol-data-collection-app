import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import JSZip from 'jszip';

// In-memory Blobs mock — mirrors u-products-image.test.ts.
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
import uProductsExportHandler from '../../netlify/functions/u-products-export';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-export-admin@example.com';
const ADMIN_PASSWORD = 'pm-export-pw';

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
    VALUES (${ADMIN_EMAIL}, ${h}, 'Export Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  blobStore.clear();
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `Export Test ${Date.now()}` }),
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

  const email = `pm-exp-${Date.now()}@example.com`;
  const pw = 'pm-exp-pw-123';
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'Export User', email, create_login: true, temp_password: pw }),
  }), CTX);
  const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }),
  }), CTX);
  buCookie = lr.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

async function makeProduct(
  name: string,
  opts: Partial<{ sku: string; brand: string; status: string }> = {},
): Promise<{ id: string }> {
  const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({ type: 'physical', name, price_cents: 12900, ...opts }),
  }), CTX);
  return (await r.json()) as { id: string };
}

async function uploadImage(productId: string, bytes = new Uint8Array([1, 2, 3, 4])): Promise<void> {
  const fd = new FormData();
  fd.append('product_id', productId);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  fd.append('file', new Blob([ab], { type: 'image/png' }), 'img.png');
  await uProductsImageHandler(new Request('http://localhost/api/u-products-image', {
    method: 'POST', headers: { cookie: buCookie }, body: fd,
  }), CTX);
}

async function exportAs(format: string): Promise<Response> {
  return uProductsExportHandler(new Request(`http://localhost/api/u-products-export?format=${format}`, {
    method: 'GET', headers: { cookie: buCookie },
  }), CTX);
}

describe('u-products-export', () => {
  test('unknown format returns 400 unknown_format', async () => {
    await makeProduct('X');
    const r = await exportAs('invalid');
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unknown_format');
  });

  test('CSV export returns a ZIP with products.csv + README.txt', async () => {
    await makeProduct('Wireless Headphones', { sku: 'WH-1', brand: 'SoundLab', status: 'active' });
    await makeProduct('USB Hub', { sku: 'USB-1', brand: 'HubCo', status: 'draft' });
    const r = await exportAs('csv');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/zip');
    expect(r.headers.get('content-disposition')).toContain('attachment');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const buf = new Uint8Array(await r.arrayBuffer());
    const z = await JSZip.loadAsync(buf);
    expect(z.file('products.csv')).not.toBeNull();
    expect(z.file('README.txt')).not.toBeNull();
    const csv = await z.file('products.csv')!.async('string');
    expect(csv).toContain('Wireless Headphones');
    expect(csv).toContain('USB Hub');
  });

  test('status filter narrows the export', async () => {
    await makeProduct('A', { sku: 'A-1', status: 'active' });
    await makeProduct('D', { sku: 'D-1', status: 'draft' });
    const r = await uProductsExportHandler(new Request('http://localhost/api/u-products-export?format=csv&status=active', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    expect(r.status).toBe(200);
    const z = await JSZip.loadAsync(new Uint8Array(await r.arrayBuffer()));
    const csv = await z.file('products.csv')!.async('string');
    expect(csv).toContain('A');
    // Quick negative: row count is header + 1 data row.
    expect(csv.trim().split('\n')).toHaveLength(2);
  });

  test('XLSX format → products.xlsx inside ZIP', async () => {
    await makeProduct('Hello', { sku: 'HELLO-1' });
    const r = await exportAs('xlsx');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/zip');
    const z = await JSZip.loadAsync(new Uint8Array(await r.arrayBuffer()));
    expect(z.file('products.xlsx')).not.toBeNull();
    expect(z.file('README.txt')).not.toBeNull();
    const xlsxBytes = await z.file('products.xlsx')!.async('uint8array');
    // XLSX is itself a ZIP — PK header.
    expect(xlsxBytes[0]).toBe(0x50);
    expect(xlsxBytes[1]).toBe(0x4b);
  });

  test('Meta format → products.csv + image included for product with an image', async () => {
    const withImg = await makeProduct('Meta-A', { sku: 'META-A' });
    await makeProduct('Meta-B', { sku: 'META-B' });
    await uploadImage(withImg.id);

    const r = await exportAs('meta');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/zip');
    const z = await JSZip.loadAsync(new Uint8Array(await r.arrayBuffer()));
    expect(z.file('products.csv')).not.toBeNull();
    expect(z.file('README.txt')).not.toBeNull();
    // Image lands under images/<sku>_main.jpg
    expect(z.file('images/META-A_main.jpg')).not.toBeNull();
    // No image for META-B.
    expect(z.file('images/META-B_main.jpg')).toBeNull();
    const csv = await z.file('products.csv')!.async('string');
    // Meta uses "in stock" with space.
    expect(csv).toMatch(/in stock/);
  });

  test('WhatsApp format → products.csv with the WhatsApp subset', async () => {
    await makeProduct('WA-1', { sku: 'WA-1' });
    const r = await exportAs('whatsapp');
    expect(r.status).toBe(200);
    const z = await JSZip.loadAsync(new Uint8Array(await r.arrayBuffer()));
    expect(z.file('products.csv')).not.toBeNull();
    expect(z.file('README.txt')).not.toBeNull();
    const csv = await z.file('products.csv')!.async('string');
    const header = csv.split('\n')[0]!;
    // WhatsApp subset must NOT include the wide `gtin`/`google_product_category` columns.
    expect(header).toContain('title');
    expect(header).toContain('availability');
    expect(header).not.toContain('google_product_category');
  });

  test('Amazon format → products.tsv (tab-delimited)', async () => {
    const withImg = await makeProduct('Amzn-A', { sku: 'AMZN-A' });
    await makeProduct('Amzn-B', { sku: 'AMZN-B' });
    await uploadImage(withImg.id);

    const r = await exportAs('amazon');
    expect(r.status).toBe(200);
    const z = await JSZip.loadAsync(new Uint8Array(await r.arrayBuffer()));
    expect(z.file('products.tsv')).not.toBeNull();
    expect(z.file('README.txt')).not.toBeNull();
    expect(z.file('images/AMZN-A_main.jpg')).not.toBeNull();
    const tsv = await z.file('products.tsv')!.async('string');
    const header = tsv.split('\n')[0]!;
    expect(header.split('\t')).toContain('sku');
    expect(header.split('\t')).toContain('item-condition');
    // 2 data rows + header
    expect(tsv.trim().split('\n')).toHaveLength(3);
  });

  test('CSV export includes discount_percent column', async () => {
    const sku = `EXP-${Date.now()}`;
    await sql`
      INSERT INTO public.products (client_id, type, name, sku, price_cents, discount_percent, sale_price_cents)
      VALUES (${clientId}::uuid, 'physical', 'DC-Export', ${sku}, 10000, 15.0, 8500)
    `;
    const r = await uProductsExportHandler(new Request(`http://localhost/api/u-products-export?format=csv&client=${clientId}`, {
      method: 'GET', headers: { cookie: buCookie },
    }), CTX);
    expect(r.status).toBe(200);
    const buf = Buffer.from(await r.arrayBuffer());
    const z = await JSZip.loadAsync(buf);
    const csvText = await z.file('products.csv')!.async('string');
    const headerLine = csvText.split('\n')[0]!;
    expect(headerLine).toContain('discount_percent');
    const headers = headerLine.split(',');
    const discIdx = headers.indexOf('discount_percent');
    expect(discIdx).toBeGreaterThan(-1);
    const dataLines = csvText.split('\n').slice(1).filter(Boolean);
    const ourRow = dataLines.find((line) => line.includes(sku));
    expect(ourRow).toBeDefined();
    const cells = ourRow!.split(',');
    expect(cells[discIdx]).toBe('15');
  });

  test('Flipkart format → products.xlsx inside ZIP', async () => {
    const withImg = await makeProduct('Fk-A', { sku: 'FK-A' });
    await makeProduct('Fk-B', { sku: 'FK-B' });
    await uploadImage(withImg.id);

    const r = await exportAs('flipkart');
    expect(r.status).toBe(200);
    const z = await JSZip.loadAsync(new Uint8Array(await r.arrayBuffer()));
    expect(z.file('products.xlsx')).not.toBeNull();
    expect(z.file('README.txt')).not.toBeNull();
    expect(z.file('images/FK-A_main.jpg')).not.toBeNull();
    const xlsxBytes = await z.file('products.xlsx')!.async('uint8array');
    expect(xlsxBytes[0]).toBe(0x50);
    expect(xlsxBytes[1]).toBe(0x4b);
  });
});
