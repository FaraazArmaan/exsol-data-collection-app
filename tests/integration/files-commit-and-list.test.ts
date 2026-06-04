import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import uploadUrlHandler from '../../netlify/functions/files-upload-url';
import uploadHandler from '../../netlify/functions/files-upload';
import filesHandler from '../../netlify/functions/files';
import { assertLastAudit } from '../helpers/audit';

// In-memory Blobs mock so integration tests run without a Netlify context.
// The mock tracks keys → { data, meta } so that getMetadata returns non-null
// after a successful set(), allowing the POST /api/files commit to confirm
// the blob exists.
const blobStore = new Map<string, { data: ArrayBuffer }>();
vi.mock('../../netlify/functions/_shared/files-storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/files-storage')>();
  return {
    ...original,
    filesStore: () => ({
      set: async (key: string, data: ArrayBuffer) => { blobStore.set(key, { data }); },
      getMetadata: async (key: string) => blobStore.has(key) ? { etag: 'mock', metadata: {} } : null,
      get: async (key: string) => blobStore.has(key) ? blobStore.get(key)!.data : null,
      delete: async (key: string) => { blobStore.delete(key); },
    }),
  };
});

const CTX = {} as Context;
const BOOTSTRAP_EMAIL = 'files-commit-list-test@example.com';
const BOOTSTRAP_PASSWORD = 'files-commit-list-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let adminId: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const hash = await hashPassword(BOOTSTRAP_PASSWORD);
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${BOOTSTRAP_EMAIL}, ${hash}, 'Files CL Test', true)
    ON CONFLICT (email)
    DO UPDATE SET password_hash = ${hash}, display_name = 'Files CL Test', is_bootstrap = true
    RETURNING id
  `) as { id: string }[];
  adminId = rows[0]!.id;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${BOOTSTRAP_EMAIL}`;
  await sql`DELETE FROM public.files WHERE uploaded_by_admin = ${adminId}::uuid`;
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

afterAll(async () => {
  await sql`DELETE FROM public.files WHERE uploaded_by_admin = ${adminId}::uuid`;
});

async function reserveAndCommit(filename: string, mime: string): Promise<{ id: string; blob_key: string }> {
  const r1 = await uploadUrlHandler(
    new Request('http://localhost/api/files-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ filename, mime, byte_size: 4 }),
    }),
    CTX,
  );
  const { blob_key, upload_token } = await r1.json();

  const r2 = await uploadHandler(
    new Request(`http://localhost/api/files-upload?token=${upload_token}`, {
      method: 'PUT',
      headers: { 'Content-Type': mime, cookie: adminCookie },
      body: 'AAAA',
    }),
    CTX,
  );
  expect(r2.status).toBe(200);

  const r3 = await filesHandler(
    new Request('http://localhost/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        blob_key,
        title: filename.replace(/\.[^.]+$/, ''),
        mime,
        byte_size: 4,
        filename,
        categories: ['finance_accounting'],
      }),
    }),
    CTX,
  );
  expect(r3.status).toBe(201);
  const body = await r3.json();
  return { id: body.file.id, blob_key };
}

describe('upload → commit → list', () => {
  test('end-to-end: PDF upload becomes a document row visible via list', async () => {
    const { id } = await reserveAndCommit('q3.pdf', 'application/pdf');

    await assertLastAudit(sql, {
      op: 'files.uploaded', targetType: 'file', targetId: id,
      actorAdminId: adminId,
    });

    const listRes = await filesHandler(
      new Request('http://localhost/api/files?type=document', {
        method: 'GET',
        headers: { cookie: adminCookie },
      }),
      CTX,
    );
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.files.map((f: any) => f.id)).toContain(id);
    expect(list.files.find((f: any) => f.id === id).type).toBe('document');
  });

  test('list filters by category (OR)', async () => {
    const { id: a } = await reserveAndCommit('a.pdf', 'application/pdf');
    await sql`INSERT INTO public.file_categories (file_id, category_key) VALUES (${a}::uuid, 'hr_payroll')`;

    const { id: b } = await reserveAndCommit('b.pdf', 'application/pdf');

    const res = await filesHandler(
      new Request('http://localhost/api/files?category=hr_payroll', {
        method: 'GET',
        headers: { cookie: adminCookie },
      }),
      CTX,
    );
    const list = await res.json();
    const ids = list.files.map((f: any) => f.id);
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
  });

  test('rejects external URL with disallowed scheme', async () => {
    const res = await filesHandler(
      new Request('http://localhost/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          external_url: 'javascript:alert(1)',
          title: 'bad',
          categories: ['marketing_brand'],
        }),
      }),
      CTX,
    );
    expect(res.status).toBe(400);
  });

  test('caps categories at 3', async () => {
    const r1 = await uploadUrlHandler(
      new Request('http://localhost/api/files-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ filename: 't.pdf', mime: 'application/pdf', byte_size: 1 }),
      }),
      CTX,
    );
    const { blob_key, upload_token } = await r1.json();
    await uploadHandler(
      new Request(`http://localhost/api/files-upload?token=${upload_token}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/pdf', cookie: adminCookie }, body: 'A',
      }),
      CTX,
    );
    const res = await filesHandler(
      new Request('http://localhost/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          blob_key,
          title: 't', mime: 'application/pdf', byte_size: 1, filename: 't.pdf',
          categories: ['finance_accounting', 'hr_payroll', 'sales_crm', 'legal_compliance'],
        }),
      }),
      CTX,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('too_many_categories');
  });
});
