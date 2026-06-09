import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

// In-memory Blobs mock — mirrors u-products-export.test.ts.
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
import uProductsExportHandler from '../../netlify/functions/u-products-export';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-export-toolarge-admin@example.com';
const ADMIN_PASSWORD = 'pm-export-toolarge-pw';

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
    VALUES (${ADMIN_EMAIL}, ${h}, 'Export TooLarge Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  blobStore.clear();
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `Export TooLarge ${Date.now()}` }),
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

  const email = `pm-exp-tl-${Date.now()}@example.com`;
  const pw = 'pm-exp-tl-pw-123';
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'TooLarge User', email, create_login: true, temp_password: pw }),
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

describe('u-products-export — 4 MB ceiling', () => {
  test('returns 413 export_too_large when assembled ZIP exceeds the cap', { timeout: 120_000 }, async () => {
    // Six products × five images × 500 KB random bytes ≈ 15 MB raw.
    // Random bytes are incompressible under DEFLATE, so the resulting ZIP
    // stays close to 15 MB — well past the 4 MB cap in wrapInZip.
    for (let p = 0; p < 6; p++) {
      const pr = await uProductsHandler(new Request('http://localhost/api/u-products', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
        body: JSON.stringify({ type: 'physical', name: `BigProduct ${p}`, sku: `BIG-${p}`, price_cents: 100 }),
      }), CTX);
      const prod = (await pr.json()) as { id: string };

      for (let i = 0; i < 5; i++) {
        const blob_key = `product-images/${clientId}/${prod.id}/img-${i}`;
        await sql`
          INSERT INTO public.product_images (product_id, blob_key, sort_order)
          VALUES (${prod.id}::uuid, ${blob_key}, ${i})
        `;
        const bytes = crypto.randomBytes(500 * 1024);
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);
        blobStore.set(blob_key, ab);
      }
    }

    const r = await uProductsExportHandler(new Request('http://localhost/api/u-products-export?format=meta', {
      method: 'GET', headers: { cookie: buCookie },
    }), CTX);

    expect(r.status).toBe(413);
    const body = (await r.json()) as {
      error: { code: string; details: { suggestion: string; size_bytes: number; limit: number } };
    };
    expect(body.error.code).toBe('export_too_large');
    expect(body.error.details.size_bytes).toBeGreaterThan(body.error.details.limit);
    expect(body.error.details.suggestion).toMatch(/filter/i);
    // Surface size info so the test log doubles as a sanity check.
    console.log(`[export-too-large] size_bytes=${body.error.details.size_bytes} limit=${body.error.details.limit}`);
  });
});
