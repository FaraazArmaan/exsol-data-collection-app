import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import brandPatchHandler from '../../netlify/functions/client-settings-brand';

const CTX = {} as Context;
const ADMIN_EMAIL = 'brand-patch-admin@example.com';
const ADMIN_PASSWORD = 'brand-patch-pw';
const sql = neon(process.env.DATABASE_URL!);
let adminCookie = '';
let clientId = '';
const createdClients: string[] = [];

function patch(body: unknown): Request {
  return new Request(`http://x/api/client-settings/brand?client=${clientId}`, {
    method: 'PATCH', headers: { cookie: adminCookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${await hashPassword(ADMIN_PASSWORD)}, 'Brand Patch Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_bootstrap = true
  `;
  const lr = await loginHandler(new Request('http://x/api/auth-login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  adminCookie = (lr.headers.get('set-cookie') ?? '').split(';')[0]!;
  const cr = await clientsHandler(new Request('http://x/api/clients', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Brand Patch Co ${Date.now()}` }),
  }), CTX);
  clientId = ((await cr.json()) as { client: { id: string } }).client.id;
  createdClients.push(clientId);
});

afterAll(async () => {
  for (const id of createdClients) await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`;
});

describe('PATCH /api/client-settings/brand', () => {
  test('partial update sets only supplied fields', async () => {
    const res = await brandPatchHandler(patch({ accent: '#3b82f6', theme: 'light' }), CTX);
    expect(res.status).toBe(200);
    const rows = (await sql`SELECT brand_accent, brand_theme, brand_font_body FROM public.clients WHERE id = ${clientId}::uuid`) as Array<{ brand_accent: string; brand_theme: string; brand_font_body: string | null }>;
    expect(rows[0]!.brand_accent).toBe('#3b82f6');
    expect(rows[0]!.brand_theme).toBe('light');
    expect(rows[0]!.brand_font_body).toBeNull();
  });

  test('stores an owned logo key', async () => {
    const key = `brand/${clientId}/logo`;
    const res = await brandPatchHandler(patch({ logoKey: key }), CTX);
    expect(res.status).toBe(200);
    const rows = (await sql`SELECT brand_logo_key FROM public.clients WHERE id = ${clientId}::uuid`) as Array<{ brand_logo_key: string }>;
    expect(rows[0]!.brand_logo_key).toBe(key);
  });

  test('replaces heroKeys atomically', async () => {
    const a = `brand/${clientId}/hero/${crypto.randomUUID()}`;
    const b = `brand/${clientId}/hero/${crypto.randomUUID()}`;
    const res = await brandPatchHandler(patch({ heroKeys: [a, b] }), CTX);
    expect(res.status).toBe(200);
    const rows = (await sql`SELECT brand_hero_keys FROM public.clients WHERE id = ${clientId}::uuid`) as Array<{ brand_hero_keys: string[] }>;
    expect(rows[0]!.brand_hero_keys).toEqual([a, b]);
  });

  test('rejects a bad hex accent → 400', async () => {
    expect((await brandPatchHandler(patch({ accent: '#zzz' }), CTX)).status).toBe(400);
  });

  test('rejects an invalid theme → 400', async () => {
    expect((await brandPatchHandler(patch({ theme: 'purple' }), CTX)).status).toBe(400);
  });

  test('rejects a foreign-tenant logo key → 400 forbidden_cross_tenant_key', async () => {
    const foreign = `brand/22222222-2222-4222-8222-222222222222/logo`;
    const res = await brandPatchHandler(patch({ logoKey: foreign }), CTX);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('forbidden_cross_tenant_key');
  });

  test('rejects a foreign-tenant hero key → 400 forbidden_cross_tenant_key', async () => {
    const foreign = `brand/22222222-2222-4222-8222-222222222222/hero/${crypto.randomUUID()}`;
    const res = await brandPatchHandler(patch({ heroKeys: [foreign] }), CTX);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('forbidden_cross_tenant_key');
  });

  test('accepts null to clear a field', async () => {
    await brandPatchHandler(patch({ accent: '#3b82f6' }), CTX);
    const res = await brandPatchHandler(patch({ accent: null }), CTX);
    expect(res.status).toBe(200);
    const rows = (await sql`SELECT brand_accent FROM public.clients WHERE id = ${clientId}::uuid`) as Array<{ brand_accent: string | null }>;
    expect(rows[0]!.brand_accent).toBeNull();
  });
});
