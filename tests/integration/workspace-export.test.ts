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

import JSZipForTest from 'jszip';

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

describe('workspace-export — admin happy paths', () => {
  test('format=json returns 200 with workspace-<slug>-<iso>.json filename', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('content-disposition')).toMatch(/filename="workspace-we-test-acme-\d{8}T\d{6}Z\.json"/);
    const body = await res.json();
    expect(body.schema_version).toBe(1);
    expect(body.client.id).toBe(clientAId);
  });

  test('format=json body never contains password_hash / temp_password_plain / password_reset_requested_at', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    const text = await res.text();
    expect(text).not.toMatch(/password_hash/);
    expect(text).not.toMatch(/temp_password_plain/);
    expect(text).not.toMatch(/password_reset_requested_at/);
  });

  test('format=zip returns 200 application/zip; manifest schema_version=1', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=zip&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/zip/);
    const buf = Buffer.from(await res.arrayBuffer());
    const z = await JSZipForTest.loadAsync(buf);
    const manifest = JSON.parse(await z.file('_manifest.json')!.async('string'));
    expect(manifest.schema_version).toBe(1);
    expect(manifest.client_id).toBe(clientAId);
  });

  test('admin without ?client= → 400 missing_client', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('missing_client');
  });
});
