import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

const blobStore = new Map<string, ArrayBuffer>();
vi.mock('../../netlify/functions/_shared/brand', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/brand')>();
  return {
    ...original,
    brandStore: () => ({
      set: async (key: string, data: ArrayBuffer) => { blobStore.set(key, data); },
      get: async (key: string) => blobStore.get(key) ?? null,
      delete: async (key: string) => { blobStore.delete(key); },
    }),
  };
});

import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import brandImageHandler from '../../netlify/functions/client-settings-brand-image';

const CTX = {} as Context;
const ADMIN_EMAIL = 'brand-img-admin@example.com';
const ADMIN_PASSWORD = 'brand-img-pw';
const sql = neon(process.env.DATABASE_URL!);
let adminCookie = '';
let clientId = '';
const createdClients: string[] = [];

// PNG magic bytes + filler.
function pngFile(): File {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return new File([bytes], 'logo.png', { type: 'image/png' });
}
function multipart(kind: string, file: File | null): Request {
  const form = new FormData();
  form.set('kind', kind);
  if (file) form.set('file', file);
  return new Request(`http://x/api/client-settings/brand-image?client=${clientId}`, {
    method: 'POST', headers: { cookie: adminCookie }, body: form,
  });
}

beforeAll(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${await hashPassword(ADMIN_PASSWORD)}, 'Brand Img Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_bootstrap = true
  `;
  const lr = await loginHandler(new Request('http://x/api/auth-login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  adminCookie = (lr.headers.get('set-cookie') ?? '').split(';')[0]!;
  const cr = await clientsHandler(new Request('http://x/api/clients', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Brand Img Co ${Date.now()}` }),
  }), CTX);
  clientId = ((await cr.json()) as { client: { id: string } }).client.id;
  createdClients.push(clientId);
});

afterAll(async () => {
  for (const id of createdClients) await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`;
});

describe('POST /api/client-settings/brand-image', () => {
  test('uploads a logo → 201 with the stable key', async () => {
    const res = await brandImageHandler(multipart('logo', pngFile()), CTX);
    expect(res.status).toBe(201);
    const body = await res.json() as { key: string };
    expect(body.key).toBe(`brand/${clientId}/logo`);
  });

  test('uploads a hero → 201 with a hero/<uuid> key', async () => {
    const res = await brandImageHandler(multipart('hero', pngFile()), CTX);
    expect(res.status).toBe(201);
    const body = await res.json() as { key: string };
    expect(body.key).toMatch(new RegExp(`^brand/${clientId}/hero/[0-9a-f-]{36}$`));
  });

  test('rejects an invalid kind → 400', async () => {
    const res = await brandImageHandler(multipart('banner', pngFile()), CTX);
    expect(res.status).toBe(400);
  });

  test('rejects bytes that sniff to a non-allowed image → 400', async () => {
    const bytes = new Uint8Array(64); bytes.set([0x00, 0x01, 0x02, 0x03], 0);
    const bad = new File([bytes], 'logo.png', { type: 'image/png' });
    const res = await brandImageHandler(multipart('logo', bad), CTX);
    expect(res.status).toBe(400);
  });

  test('missing file → 400', async () => {
    const res = await brandImageHandler(multipart('logo', null), CTX);
    expect(res.status).toBe(400);
  });

  test('no cookie → 401', async () => {
    const form = new FormData(); form.set('kind', 'logo'); form.set('file', pngFile());
    const res = await brandImageHandler(new Request(`http://x/api/client-settings/brand-image?client=${clientId}`, {
      method: 'POST', body: form,
    }), CTX);
    expect(res.status).toBe(401);
  });
});
