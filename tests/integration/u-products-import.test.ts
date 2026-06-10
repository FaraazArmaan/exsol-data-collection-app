import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import userNodesHandler from '../../netlify/functions/user-nodes';
import uLoginHandler from '../../netlify/functions/u-login';
import uProductsImportHandler from '../../netlify/functions/u-products-import';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-import-admin@example.com';
const ADMIN_PASSWORD = 'pm-import-pw';

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
  const email = `pm-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'pm-imp-pw-123';
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'Import User', email, create_login: true, temp_password: password }),
  }), CTX);
  const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  }), CTX);
  return lr.headers.get('set-cookie')!.split(';')[0]!;
}

async function postFile(path: string, fixture: string): Promise<Response> {
  const bytes = readFileSync(join(__dirname, '../fixtures/products', fixture));
  // Wrap in an explicit ArrayBuffer copy for TS narrowness.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const fd = new FormData();
  fd.append('file', new Blob([ab], { type: 'text/csv' }), fixture);
  return uProductsImportHandler(new Request(`http://localhost/api/u-products-import${path}`, {
    method: 'POST', headers: { cookie: buCookie }, body: fd,
  }), CTX);
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Import Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `Import Test ${Date.now()}` }),
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

describe('u-products-import', () => {
  test('dry_run returns summary without writing', async () => {
    const r = await postFile('?dry_run=1', 'import-valid.csv');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { summary: { to_create: number }; valid: unknown[] };
    expect(body.summary.to_create).toBe(3);
    const rows = (await sql`SELECT COUNT(*)::int AS c FROM public.products WHERE client_id = ${clientId}::uuid`) as { c: number }[];
    expect(rows[0]!.c).toBe(0);
  });

  test('commit writes rows + auto-creates categories', async () => {
    const r = await postFile('', 'import-valid.csv');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { committed: boolean; created_ids: string[] };
    expect(body.committed).toBe(true);
    expect(body.created_ids).toHaveLength(3);
    const cats = (await sql`SELECT name FROM public.product_categories WHERE client_id = ${clientId}::uuid ORDER BY name`) as { name: string }[];
    expect(cats.map((c) => c.name)).toEqual(['Electronics', 'Services']);
  });

  test('mixed-errors fixture surfaces per-row errors and does not commit', async () => {
    const r = await postFile('', 'import-mixed-errors.csv');
    const body = (await r.json()) as { committed?: boolean; errors: Array<{ row: number; field?: string; message: string }> };
    expect(body.errors.length).toBeGreaterThanOrEqual(2);
    expect(body.committed).toBe(false);
    const rows = (await sql`SELECT COUNT(*)::int AS c FROM public.products WHERE client_id = ${clientId}::uuid`) as { c: number }[];
    expect(rows[0]!.c).toBe(0);
  });

  test('second commit with same SKU upserts (action=update)', async () => {
    await postFile('', 'import-valid.csv');
    const r = await postFile('?dry_run=1', 'import-valid.csv');
    const body = (await r.json()) as { summary: { to_create: number; to_update: number }; valid: Array<{ action: string }> };
    expect(body.summary.to_update).toBeGreaterThan(0);
    expect(body.valid.some((v) => v.action === 'update')).toBe(true);
  });

  test('emits a warning when sale_price is set without a sale window', async () => {
    const csv = [
      'sku,name,type,price,sale_price,sale_starts_at',
      'W-SP,Widget,physical,10.00,5.00,',
    ].join('\n');
    const ab = new ArrayBuffer(csv.length);
    new Uint8Array(ab).set(new TextEncoder().encode(csv));
    const fd = new FormData();
    fd.append('file', new Blob([ab], { type: 'text/csv' }), 'p.csv');
    const r = await uProductsImportHandler(new Request(`http://localhost/api/u-products-import?dry_run=1&client=${clientId}`, {
      method: 'POST', headers: { cookie: buCookie }, body: fd,
    }), CTX);
    expect(r.status).toBe(200);
    const body = await r.json() as { warnings: Array<{ row: number; message: string }> };
    expect(body.warnings.some((w) => /sale price.*no sale window/i.test(w.message))).toBe(true);
  });

  test('imports new products with full Phase B field set', async () => {
    const csv = readFileSync(join(__dirname, '../fixtures/products/import-phase-b-full.csv'));
    const ab = new ArrayBuffer(csv.length);
    new Uint8Array(ab).set(csv);
    const fd = new FormData();
    fd.append('file', new Blob([ab], { type: 'text/csv' }), 'p.csv');
    const r = await uProductsImportHandler(new Request(`http://localhost/api/u-products-import?client=${clientId}`, {
      method: 'POST', headers: { cookie: buCookie }, body: fd,
    }), CTX);
    expect(r.status).toBe(200);
    const body = await r.json() as { committed: boolean; summary: { to_create: number; to_update: number; errors: number } };
    expect(body.committed).toBe(true);
    expect(body.summary.errors).toBe(0);

    const rows = await sql`
      SELECT sku, gtin, condition, availability, sale_price_cents,
             weight_grams, length_mm, color, gst_rate, country_of_origin
      FROM public.products
      WHERE client_id = ${clientId}::uuid AND sku = 'WH-1'
    ` as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.gtin).toBe('1234567890123');
    expect(row.condition).toBe('new');
    expect(row.availability).toBe('in_stock');
    expect(row.sale_price_cents).toBe(9900);
    expect(row.weight_grams).toBe(250);
    expect(row.length_mm).toBe(200);
    expect(row.color).toBe('Black');
    expect(String(row.gst_rate)).toBe('18.00');
    expect(row.country_of_origin).toBe('India');
  });

  test('legacy 12-column CSV does NOT wipe Phase B columns on existing products', async () => {
    // Seed an existing product with all Phase B columns populated via SQL directly.
    const seededSku = `BC-${Date.now()}`;
    await sql`
      INSERT INTO public.products (
        client_id, type, name, sku, price_cents,
        gtin, mpn, condition, availability,
        sale_price_cents, weight_grams, color, gst_rate,
        country_of_origin, hsn_code
      ) VALUES (
        ${clientId}::uuid, 'physical', 'Seeded', ${seededSku}, 1000,
        'GTIN-X', 'MPN-X', 'refurbished', 'preorder',
        900, 250, 'Red', 18.0, 'India', 'HSN-X'
      )
    `;

    // Re-import via legacy 12-column CSV (no Phase B headers) using the same SKU.
    const csv = [
      'sku,name,type,category,brand,price,currency,stock_qty,unit,status,tags,description',
      `${seededSku},Updated Name,physical,Electronics,,15.00,USD,3,each,active,,Updated description`,
    ].join('\n');
    const ab = new ArrayBuffer(csv.length);
    new Uint8Array(ab).set(new TextEncoder().encode(csv));
    const fd = new FormData();
    fd.append('file', new Blob([ab], { type: 'text/csv' }), 'p.csv');
    const r = await uProductsImportHandler(new Request(`http://localhost/api/u-products-import?client=${clientId}`, {
      method: 'POST', headers: { cookie: buCookie }, body: fd,
    }), CTX);
    expect(r.status).toBe(200);

    // Verify: name + description updated, every Phase B column preserved.
    const rows = await sql`
      SELECT name, description, gtin, mpn, condition, availability,
             sale_price_cents, weight_grams, color, gst_rate,
             country_of_origin, hsn_code
      FROM public.products WHERE sku = ${seededSku} AND client_id = ${clientId}::uuid
    ` as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.name).toBe('Updated Name');
    expect(row.description).toBe('Updated description');
    expect(row.gtin).toBe('GTIN-X');
    expect(row.mpn).toBe('MPN-X');
    expect(row.condition).toBe('refurbished');
    expect(row.availability).toBe('preorder');
    expect(row.sale_price_cents).toBe(900);
    expect(row.weight_grams).toBe(250);
    expect(row.color).toBe('Red');
    expect(String(row.gst_rate)).toBe('18.00');
    expect(row.country_of_origin).toBe('India');
    expect(row.hsn_code).toBe('HSN-X');
  });
});
