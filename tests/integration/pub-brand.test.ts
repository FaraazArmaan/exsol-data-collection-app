import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

// The public rate limiter (_pub-ratelimit) reads/writes a Netlify Blobs store,
// which is unavailable in tests. Back it with an in-memory Map (mirrors
// tests/pos/pub-menu.test.ts).
vi.mock('@netlify/blobs', () => {
  const store = new Map<string, string>();
  return {
    getStore: () => ({
      get: async (k: string) => store.get(k) ?? null,
      setJSON: async (k: string, v: unknown) => { store.set(k, JSON.stringify(v)); },
    }),
  };
});

import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import pubBrandHandler from '../../netlify/functions/pub-brand';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pub-brand-admin@example.com';
const ADMIN_PASSWORD = 'pub-brand-pw';
const sql = neon(process.env.DATABASE_URL!);
let clientId = '';
let slug = '';
let heroKey = '';
const created: string[] = [];

beforeAll(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${await hashPassword(ADMIN_PASSWORD)}, 'Pub Brand Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_bootstrap = true
  `;
  const lr = await loginHandler(new Request('http://x/api/auth-login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  const cookie = (lr.headers.get('set-cookie') ?? '').split(';')[0]!;
  const cr = await clientsHandler(new Request('http://x/api/clients', {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Pub Brand Co ${Date.now()}` }),
  }), CTX);
  const cb = (await cr.json()) as { client: { id: string; slug: string } };
  clientId = cb.client.id;
  slug = cb.client.slug;
  created.push(clientId);
  heroKey = `brand/${clientId}/hero/${crypto.randomUUID()}`;
  await sql`
    UPDATE public.clients SET
      brand_logo_key = ${`brand/${clientId}/logo`},
      brand_hero_keys = ${[heroKey]}::text[],
      brand_accent = '#3b82f6', brand_theme = 'light', brand_font_heading = 'Inter'
    WHERE id = ${clientId}::uuid
  `;
});
afterAll(async () => { for (const id of created) await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; });

function get(s: string): Request {
  return new Request(`http://x/api/public/brand/${s}`, { method: 'GET', headers: { 'x-forwarded-for': '9.9.9.9' } });
}

describe('GET /api/public/brand/:slug', () => {
  test('known slug → 200 with full brand shape + cache header', async () => {
    const res = await pubBrandHandler(get(slug));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=60');
    const b = await res.json() as Record<string, unknown>;
    expect(b.name).toContain('Pub Brand Co');
    expect(b.theme).toBe('light');
    expect(b.accent).toBe('#3b82f6');
    expect(b.fontHeading).toBe('Inter');
    expect(b.logoUrl).toBe(`/api/public/brand/${slug}/image/brand/${clientId}/logo`);
    expect(Array.isArray(b.heroUrls)).toBe(true);
    expect((b.heroUrls as string[]).length).toBe(1);
    expect((b.heroUrls as string[])[0]).toBe(`/api/public/brand/${slug}/image/${heroKey}`);
    expect(b.logoAltUrl).toBeNull();
  });

  test('unknown slug → 404', async () => {
    expect((await pubBrandHandler(get('no-such-slug-xyz'))).status).toBe(404);
  });
});
