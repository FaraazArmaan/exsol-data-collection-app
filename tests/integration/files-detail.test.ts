import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

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

import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import uploadUrlHandler from '../../netlify/functions/files-upload-url';
import uploadHandler from '../../netlify/functions/files-upload';
import filesHandler from '../../netlify/functions/files';
import detailHandler from '../../netlify/functions/files-detail';
import { assertLastAudit } from '../helpers/audit';

const CTX = {} as Context;
const EMAIL = 'files-detail-test@example.com';
const PW = 'files-detail-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let adminId: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const hash = await hashPassword(PW);
  const r = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${EMAIL}, ${hash}, 'Detail Test', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash}, display_name = 'Detail Test', is_bootstrap = true
    RETURNING id
  `) as { id: string }[];
  adminId = r[0]!.id;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${EMAIL}`;
  await sql`DELETE FROM public.files WHERE uploaded_by_admin = ${adminId}::uuid`;
  const res = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW }),
    }), CTX,
  );
  adminCookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  await sql`DELETE FROM public.files WHERE uploaded_by_admin = ${adminId}::uuid`;
});

async function createFile(): Promise<string> {
  const r1 = await uploadUrlHandler(
    new Request('http://localhost/api/files-upload-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ filename: 'x.pdf', mime: 'application/pdf', byte_size: 4 }),
    }), CTX,
  );
  const { blob_key, upload_token } = await r1.json();
  await uploadHandler(
    new Request(`http://localhost/api/files-upload?token=${upload_token}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/pdf', cookie: adminCookie }, body: 'AAAA',
    }), CTX,
  );
  const r3 = await filesHandler(
    new Request('http://localhost/api/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        blob_key, title: 'Initial', mime: 'application/pdf', byte_size: 4, filename: 'x.pdf',
        categories: ['finance_accounting'],
      }),
    }), CTX,
  );
  return (await r3.json()).file.id as string;
}

describe('GET /api/files-detail/:id', () => {
  test('returns the file row + categories', async () => {
    const id = await createFile();
    const res = await detailHandler(
      new Request(`http://localhost/api/files-detail/${id}`, {
        method: 'GET', headers: { cookie: adminCookie },
      }), CTX,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.file.id).toBe(id);
    expect(body.file.categories).toEqual(['finance_accounting']);
  });

  test('404 for unknown id', async () => {
    const res = await detailHandler(
      new Request('http://localhost/api/files-detail/00000000-0000-0000-0000-000000000000', {
        method: 'GET', headers: { cookie: adminCookie },
      }), CTX,
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/files-detail/:id', () => {
  test('updates title + categories', async () => {
    const id = await createFile();
    const res = await detailHandler(
      new Request(`http://localhost/api/files-detail/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ title: 'Renamed', categories: ['hr_payroll', 'legal_compliance'] }),
      }), CTX,
    );
    expect(res.status).toBe(200);
    await assertLastAudit(sql, { op: 'files.metadata_edited', targetType: 'file', targetId: id });
  });
});

describe('DELETE /api/files-detail/:id', () => {
  test('soft delete sets deleted_at + logs files.deleted_soft', async () => {
    const id = await createFile();
    const res = await detailHandler(
      new Request(`http://localhost/api/files-detail/${id}`, {
        method: 'DELETE', headers: { cookie: adminCookie },
      }), CTX,
    );
    expect(res.status).toBe(204);
    const rows = (await sql`SELECT deleted_at FROM public.files WHERE id = ${id}::uuid`) as { deleted_at: string | null }[];
    expect(rows[0]!.deleted_at).not.toBeNull();
    await assertLastAudit(sql, { op: 'files.deleted_soft', targetType: 'file', targetId: id });
  });

  test('hard delete removes the row + logs files.deleted_hard', async () => {
    const id = await createFile();
    const res = await detailHandler(
      new Request(`http://localhost/api/files-detail/${id}?hard=true`, {
        method: 'DELETE', headers: { cookie: adminCookie },
      }), CTX,
    );
    expect(res.status).toBe(204);
    const rows = (await sql`SELECT id FROM public.files WHERE id = ${id}::uuid`) as { id: string }[];
    expect(rows).toHaveLength(0);
    await assertLastAudit(sql, { op: 'files.deleted_hard', targetType: 'file', targetId: id });
  });
});
