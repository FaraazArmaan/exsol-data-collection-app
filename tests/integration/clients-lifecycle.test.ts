// tests/integration/clients-lifecycle.test.ts
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientsDetailHandler from '../../netlify/functions/clients-detail';
import { assertLastAudit } from '../helpers/audit';

const ADMIN_EMAIL = 'clients-lifecycle-test@example.com';
const ADMIN_PASSWORD = 'clients-lifecycle-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
const created: string[] = [];

function loginReq(email: string, password: string): Request {
  return new Request('http://localhost/api/auth-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function getCookie(): Promise<string> {
  const r = await loginHandler(loginReq(ADMIN_EMAIL, ADMIN_PASSWORD), CTX);
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Clients Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, display_name = 'Clients Test Admin'
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  cookie = await getCookie();
});

afterAll(async () => {
  for (const id of created) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

describe('clients lifecycle', () => {
  test('POST /api/clients with valid body returns 201 + client', async () => {
    const r = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Lifecycle Test Co' }),
      }),
      CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { client: { id: string; name: string; slug: string } };
    expect(body.client.name).toBe('Lifecycle Test Co');
    expect(body.client.slug).toMatch(/^lifecycle-test-co/);
    created.push(body.client.id);
    await assertLastAudit(sql, {
      op: 'client.created',
      targetType: 'client',
      targetId: body.client.id,
      clientId: body.client.id,
    });
  });

  test('POST with empty name returns 400 validation_failed', async () => {
    const r = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: '' }),
      }),
      CTX,
    );
    expect(r.status).toBe(400);
  });

  test('GET /api/clients lists created clients', async () => {
    const r = await clientsHandler(new Request('http://localhost/api/clients', { method: 'GET', headers: { cookie } }), CTX);
    expect(r.status).toBe(200);
    const body = await r.json() as { clients: Array<{ id: string }> };
    expect(Array.isArray(body.clients)).toBe(true);
  });

  test('POST without auth returns 401', async () => {
    const r = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'noauth' }),
      }),
      CTX,
    );
    expect(r.status).toBe(401);
  });

  test('GET /api/clients-detail returns the client', async () => {
    const c = await clientsHandler(
      new Request('http://localhost/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Detail Test Co' }),
      }),
      CTX,
    );
    const body = await c.json() as { client: { id: string } };
    created.push(body.client.id);

    const g = await clientsDetailHandler(
      new Request(`http://localhost/api/clients-detail?id=${body.client.id}`, { method: 'GET', headers: { cookie } }),
      CTX,
    );
    expect(g.status).toBe(200);
    const detail = await g.json() as { client: { id: string; name: string } };
    expect(detail.client.name).toBe('Detail Test Co');
  });

  test('DELETE /api/clients-detail with nonexistent id returns 404', async () => {
    const r = await clientsDetailHandler(
      new Request('http://localhost/api/clients-detail?id=00000000-0000-0000-0000-000000000000', { method: 'DELETE', headers: { cookie } }),
      CTX,
    );
    expect(r.status).toBe(404);
  });
});
