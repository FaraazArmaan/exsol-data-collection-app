import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import quotaHandler from '../../netlify/functions/files-quota';

const CTX = {} as Context;
const BOOTSTRAP_EMAIL = 'files-quota-test@example.com';
const BOOTSTRAP_PASSWORD = 'files-quota-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const hash = await hashPassword(BOOTSTRAP_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${BOOTSTRAP_EMAIL}, ${hash}, 'Files Quota Test', true)
    ON CONFLICT (email)
    DO UPDATE SET password_hash = ${hash}, display_name = 'Files Quota Test', is_bootstrap = true
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${BOOTSTRAP_EMAIL}`;
  const res = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD }),
    }),
    CTX,
  );
  adminCookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

describe('GET /api/files-quota', () => {
  test('admin can read a client quota via ?client_id', async () => {
    const c = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (c.length === 0) return;
    const res = await quotaHandler(
      new Request(`http://localhost/api/files-quota?client_id=${c[0]!.id}`, {
        headers: { cookie: adminCookie },
      }),
      CTX,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.byte_limit).toBe('number');
    expect(typeof body.bytes_used).toBe('number');
    await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${c[0]!.id}::uuid`;
  });

  test('unauthenticated → 401', async () => {
    const res = await quotaHandler(new Request('http://localhost/api/files-quota'), CTX);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/files-quota', () => {
  test('admin sets a new limit; DB reflects it', async () => {
    const c = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (c.length === 0) return;
    const cid = c[0]!.id;
    try {
      const res = await quotaHandler(
        new Request('http://localhost/api/files-quota', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ client_id: cid, byte_limit: 1073741824 }),
        }),
        CTX,
      );
      expect(res.status).toBe(200);
      const after = (await sql`
        SELECT byte_limit FROM public.workspace_storage_quota WHERE client_id = ${cid}::uuid
      `) as { byte_limit: string }[];
      expect(Number(after[0]!.byte_limit)).toBe(1073741824);
    } finally {
      await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${cid}::uuid`;
    }
  });

  test('missing client_id → 400 quota_target_required', async () => {
    const res = await quotaHandler(
      new Request('http://localhost/api/files-quota', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ byte_limit: 1 }),
      }),
      CTX,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('quota_target_required');
  });
});
