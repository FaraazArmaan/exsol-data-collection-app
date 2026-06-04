import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import uploadUrlHandler from '../../netlify/functions/files-upload-url';

const CTX = {} as Context;
const BOOTSTRAP_EMAIL = 'files-upload-url-test@example.com';
const BOOTSTRAP_PASSWORD = 'files-upload-url-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const hash = await hashPassword(BOOTSTRAP_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${BOOTSTRAP_EMAIL}, ${hash}, 'Files Test', true)
    ON CONFLICT (email)
    DO UPDATE SET password_hash = ${hash}, display_name = 'Files Test', is_bootstrap = true
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

describe('POST /api/files-upload-url', () => {
  test('admin gets a key + upload token', async () => {
    const res = await uploadUrlHandler(
      new Request('http://localhost/api/files-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ filename: 'q3.pdf', mime: 'application/pdf', byte_size: 1024 }),
      }),
      CTX,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blob_key).toMatch(/^admin\//);
    expect(typeof body.upload_token).toBe('string');
  });

  test('unauthenticated → 401', async () => {
    const res = await uploadUrlHandler(
      new Request('http://localhost/api/files-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'q.pdf', mime: 'application/pdf', byte_size: 1 }),
      }),
      CTX,
    );
    expect(res.status).toBe(401);
  });

  test('rejects blocked MIME', async () => {
    const res = await uploadUrlHandler(
      new Request('http://localhost/api/files-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ filename: 'evil.exe', mime: 'application/x-msdownload', byte_size: 1 }),
      }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('mime_not_allowed');
  });
});
