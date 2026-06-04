vi.mock('../../netlify/functions/_shared/google-verifier', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import adminClientProductsHandler from '../../netlify/functions/admin-client-products';
import { assertLastAudit } from '../helpers/audit';

const ADMIN_EMAIL = 'acp-test@example.com';
const ADMIN_PASSWORD = 'acp-test-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let clientId: string;
const created: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'ACP Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const lr = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  cookie = lr.headers.get('set-cookie')!.split(';')[0]!;
  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `ACP Test ${Date.now()}` }),
    }), CTX,
  );
  clientId = ((await cr.json()) as { client: { id: string } }).client.id;
  created.push(clientId);
});

afterAll(async () => {
  for (const id of created) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

describe('admin-client-products', () => {
  it('GET returns empty enabled + the full Product catalog', async () => {
    const r = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, { headers: { cookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { enabled_keys: string[]; available: Array<{ key: string; label: string }> };
    expect(body.enabled_keys).toEqual([]);
    expect(body.available.find((p) => p.key === 'saloon-booking')).toBeDefined();
  });

  it('PUT replaces the enabled set', async () => {
    const r1 = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['saloon-booking'] }),
      }), CTX,
    );
    expect(r1.status).toBe(200);

    const r2 = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, { headers: { cookie } }),
      CTX,
    );
    const body = await r2.json() as { enabled_keys: string[] };
    expect(body.enabled_keys).toEqual(['saloon-booking']);
    await assertLastAudit(sql, {
      op: 'products.replaced',
      targetType: 'client',
      targetId: clientId,
      clientId,
    });
  });

  it('PUT with empty keys clears all enabled products', async () => {
    await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['saloon-booking'] }),
      }), CTX,
    );
    await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: [] }),
      }), CTX,
    );
    const r = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, { headers: { cookie } }),
      CTX,
    );
    const body = await r.json() as { enabled_keys: string[] };
    expect(body.enabled_keys).toEqual([]);
  });

  it('PUT rejects unknown Product keys with 400', async () => {
    const r = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ keys: ['not-a-real-product'] }),
      }), CTX,
    );
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('unknown_product_key');
  });

  it('GET without admin cookie returns 401', async () => {
    const r = await adminClientProductsHandler(
      new Request(`http://localhost/api/admin-client-products?client=${clientId}`),
      CTX,
    );
    expect(r.status).toBe(401);
  });
});
