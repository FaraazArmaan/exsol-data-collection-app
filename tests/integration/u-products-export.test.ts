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

async function makeProduct(name: string, opts: Partial<{ sku: string; brand: string; status: string }> = {}): Promise<void> {
  await uProductsHandler(new Request('http://localhost/api/u-products', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({ type: 'physical', name, price_cents: 12900, ...opts }),
  }), CTX);
}

describe('u-products-export', () => {
  test('CSV export has the header + one row per product', async () => {
    await makeProduct('Wireless Headphones', { sku: 'WH-1', brand: 'SoundLab', status: 'active' });
    await makeProduct('USB Hub', { sku: 'USB-1', brand: 'HubCo', status: 'draft' });
    const r = await uProductsExportHandler(new Request('http://localhost/api/u-products-export?format=csv', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
    expect(r.headers.get('content-disposition')).toContain('attachment');
    const csv = await r.text();
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('sku,name,type,category');
    expect(lines).toHaveLength(3);
    expect(csv).toContain('Wireless Headphones');
    expect(csv).toContain('USB Hub');
  });

  test('status filter narrows the export', async () => {
    await makeProduct('A', { status: 'active' });
    await makeProduct('D', { status: 'draft' });
    const r = await uProductsExportHandler(new Request('http://localhost/api/u-products-export?format=csv&status=active', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    const csv = await r.text();
    expect(csv).toContain('A,physical');
    expect(csv).not.toContain('D,physical');
  });

  test('XLSX returns a binary spreadsheet', async () => {
    await makeProduct('Hello');
    const r = await uProductsExportHandler(new Request('http://localhost/api/u-products-export?format=xlsx', { method: 'GET', headers: { cookie: buCookie } }), CTX);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('spreadsheetml');
    const buf = new Uint8Array(await r.arrayBuffer());
    // XLSX is a ZIP (starts with PK\x03\x04)
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});
