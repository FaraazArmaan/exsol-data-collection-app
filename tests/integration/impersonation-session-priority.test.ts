// Session-priority contract for dual-tier endpoints (authenticateForPermission)
// when BOTH an admin `session` cookie and a workspace `bu_session` cookie are
// present — the exact state the admin "view as client" impersonation feature
// creates (admin-impersonate.ts keeps the admin session and adds an Owner
// bu_session).
//
// Pre-fix behavior (admin-first): every such endpoint resolved as ADMIN and
// demanded ?client=, so the workspace UI got missing_client (400) on Product
// Manager, Team, Storefront settings, Analytics, and the dashboard cards.
// The contract pinned here: the WORKSPACE session wins when it exists; the
// admin path is unchanged when no bu_session rides along.
import { describe, it, expect, beforeAll } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import productsHandler from '../../netlify/functions/u-products';
import { seedClientWithProductsEnabled, type PosTestCtx } from '../pos/_helpers';
import { mintSession } from '../../netlify/functions/_shared/session';
import { hashPassword } from '../../netlify/functions/_shared/argon';

const sql = neon(process.env.DATABASE_URL!);
const CTX = {} as Context;

let ctx: PosTestCtx;          // workspace with products enabled; ctx.cookie = Owner bu_session
let adminCookie: string;      // a real admins-table session cookie

async function mintAdminCookie(): Promise<string> {
  const email = `imp-priority-${Math.random().toString(36).slice(2, 8)}@exsol.test`;
  const hash = await hashPassword('imp-priority-pw');
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${email}, ${hash}, 'Imp Priority Test Admin', false)
    RETURNING id
  `) as Array<{ id: string }>;
  const token = await mintSession({ sub: rows[0]!.id, email });
  return `session=${token}`;
}

function get(url: string, cookie: string): Promise<Response> {
  return productsHandler(new Request(url, { headers: { cookie } }), CTX);
}

beforeAll(async () => {
  ctx = await seedClientWithProductsEnabled();
  adminCookie = await mintAdminCookie();
});

describe('authenticateForPermission session priority (impersonation contract)', () => {
  it('BOTH cookies, no ?client= → workspace session wins (was missing_client pre-fix)', async () => {
    const res = await get('http://localhost/api/u-products?page=1', `${adminCookie}; ${ctx.cookie}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.products ?? body.items ?? [])).toBe(true);
  });

  it('BOTH cookies, ?client= matching the workspace → still the workspace session (200)', async () => {
    const res = await get(`http://localhost/api/u-products?page=1&client=${ctx.clientId}`, `${adminCookie}; ${ctx.cookie}`);
    expect(res.status).toBe(200);
  });

  it('BOTH cookies, ?client= for a DIFFERENT client → 403 forbidden (workspace scope is authoritative)', async () => {
    // Deliberate semantic of bucket-first: an admin who wants cross-client
    // admin scope must not carry a bu_session (exit impersonation first).
    const res = await get(
      'http://localhost/api/u-products?page=1&client=00000000-0000-4000-8000-00000000dead',
      `${adminCookie}; ${ctx.cookie}`,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('forbidden_cross_client');
  });

  it('admin cookie ONLY + ?client= → admin path unchanged (200)', async () => {
    const res = await get(`http://localhost/api/u-products?page=1&client=${ctx.clientId}`, adminCookie);
    expect(res.status).toBe(200);
  });

  it('admin cookie ONLY, no ?client= → missing_client unchanged (400)', async () => {
    const res = await get('http://localhost/api/u-products?page=1', adminCookie);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('missing_client');
  });

  it('bu_session ONLY → unchanged (200)', async () => {
    const res = await get('http://localhost/api/u-products?page=1', ctx.cookie);
    expect(res.status).toBe(200);
  });

  it('STALE bu_session + valid admin cookie + ?client= → falls through to admin (not 401)', async () => {
    const res = await get(
      `http://localhost/api/u-products?page=1&client=${ctx.clientId}`,
      `${adminCookie}; bu_session=not-a-valid-token`,
    );
    expect(res.status).toBe(200);
  });

  it('no cookies → 401', async () => {
    const res = await productsHandler(new Request('http://localhost/api/u-products?page=1'), CTX);
    expect(res.status).toBe(401);
  });
});
