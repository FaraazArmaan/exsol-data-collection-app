import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import workspaceExportHandler from '../../netlify/functions/workspace-export';

const ADMIN_EMAIL = 'workspace-export-test@example.com';
const ADMIN_PASSWORD = 'workspace-export-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let adminId: string;
let adminCookie: string;
let clientAId: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'WE Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
    RETURNING id
  `) as { id: string }[];
  adminId = rows[0]!.id;

  // Seed a minimal client
  const clientRows = (await sql`
    INSERT INTO public.clients (slug, name, created_by)
    VALUES ('we-test-acme', 'WE Test Acme', ${adminId})
    ON CONFLICT (slug) DO UPDATE SET name = 'WE Test Acme'
    RETURNING id
  `) as { id: string }[];
  clientAId = clientRows[0]!.id;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const lr = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  adminCookie = lr.headers.get('set-cookie')!.split(';')[0]!;
});

afterEach(async () => {
  await sql`DELETE FROM public.audit_log WHERE op = 'workspace.exported' AND client_id = ${clientAId}::uuid`;
});

function buildReq(qs: string, opts: { cookie?: string; method?: string } = {}) {
  return new Request(`http://localhost/api/workspace-export${qs}`, {
    method: opts.method ?? 'GET',
    headers: opts.cookie ? { cookie: opts.cookie } : {},
  });
}

describe('workspace-export — gates', () => {
  test('POST → 405', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie, method: 'POST' }),
      CTX,
    );
    expect(res.status).toBe(405);
  });

  test('missing format → 400 invalid_format', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('invalid_format');
  });

  test('format=foo → 400 invalid_format', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=foo&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(400);
  });

  test('no cookie → 401', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`),
      CTX,
    );
    expect(res.status).toBe(401);
  });
});
