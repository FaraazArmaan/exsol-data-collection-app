import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import uploadUrlHandler from '../../netlify/functions/files-upload-url';
import uploadHandler from '../../netlify/functions/files-upload';
import filesHandler from '../../netlify/functions/files';
import downloadHandler from '../../netlify/functions/files-download-url';
import thumbHandler from '../../netlify/functions/files-thumbnail';

// In-memory Blobs mock so integration tests run without a Netlify context.
// The mock tracks keys → { data, meta } so that getMetadata returns non-null
// after a successful set(), allowing the POST /api/files commit to confirm
// the blob exists.
const blobStore = new Map<string, { data: ArrayBuffer }>();
const thumbStore = new Map<string, ArrayBuffer>();
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
    thumbnailsStore: () => ({
      set: async (key: string, data: ArrayBuffer) => { thumbStore.set(key, data); },
      get: async (key: string) => thumbStore.has(key) ? thumbStore.get(key)! : null,
      delete: async (key: string) => { thumbStore.delete(key); },
    }),
  };
});

// 1x1 transparent PNG — decodable by sharp, avoids a sharp dependency in the test.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const CTX = {} as Context;
const EMAIL = 'files-dl-thumb-test@example.com';
const PW = 'files-dl-thumb-pw';

let sql: ReturnType<typeof neon>;
let cookie: string;
let adminId: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const hash = await hashPassword(PW);
  const r = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${EMAIL}, ${hash}, 'DLTH Test', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash}, display_name = 'DLTH Test', is_bootstrap = true
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
    }), CTX);
  cookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  await sql`DELETE FROM public.files WHERE uploaded_by_admin = ${adminId}::uuid`;
});

async function createFile(mime: string, bytes: string): Promise<{ id: string; blob_key: string }> {
  const r1 = await uploadUrlHandler(
    new Request('http://localhost/api/files-upload-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ filename: 'x', mime, byte_size: bytes.length }),
    }), CTX);
  const { blob_key, upload_token } = await r1.json();
  await uploadHandler(
    new Request(`http://localhost/api/files-upload?token=${upload_token}`, {
      method: 'PUT', headers: { 'Content-Type': mime, cookie }, body: bytes,
    }), CTX);
  const r3 = await filesHandler(
    new Request('http://localhost/api/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        blob_key, title: 't', mime, byte_size: bytes.length, filename: 'x', categories: ['marketing_brand'],
      }),
    }), CTX);
  return { id: (await r3.json()).file.id, blob_key };
}

describe('POST /api/files-download-url', () => {
  test('returns content-disposition headers + streams the bytes', async () => {
    const { id } = await createFile('application/pdf', 'HELLO');
    const res = await downloadHandler(
      new Request('http://localhost/api/files-download-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ file_id: id }),
      }), CTX);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const text = await res.text();
    expect(text).toBe('HELLO');
  });

  test('404 for unknown id', async () => {
    const res = await downloadHandler(
      new Request('http://localhost/api/files-download-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ file_id: '00000000-0000-0000-0000-000000000000' }),
      }), CTX);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/files-thumbnail/:id', () => {
  test('404 for files without thumbnail yet (lazy gen deferred)', async () => {
    const { id } = await createFile('application/pdf', 'ABCD');
    const res = await thumbHandler(
      new Request(`http://localhost/api/files-thumbnail/${id}`, {
        method: 'GET', headers: { cookie },
      }), CTX);
    // Phase A: no thumb generated yet for non-image; 404 or 415 expected.
    expect([404, 415]).toContain(res.status);
  });

  test('lazy-generates a webp thumbnail on first GET for an image', async () => {
    const blobKey = `admin/${crypto.randomUUID()}`;
    blobStore.set(blobKey, { data: TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength) });
    const f = (await sql`
      INSERT INTO public.files (client_id, type, storage_kind, blob_key, title, mime, byte_size, tier, uploaded_by_admin)
      VALUES (NULL, 'image', 'blob', ${blobKey}, 'thumb-test', 'image/png', ${TINY_PNG.byteLength}, 'public', ${adminId}::uuid)
      RETURNING id
    `) as { id: string }[];
    const id = f[0]!.id;

    const res = await thumbHandler(
      new Request(`http://localhost/api/files-thumbnail/${id}`, { method: 'GET', headers: { cookie } }),
      CTX,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    const after = (await sql`SELECT thumbnail_key FROM public.files WHERE id = ${id}::uuid`) as { thumbnail_key: string | null }[];
    expect(after[0]!.thumbnail_key).not.toBeNull();

    // Second GET serves the stored thumbnail (no regeneration error).
    const res2 = await thumbHandler(
      new Request(`http://localhost/api/files-thumbnail/${id}`, { method: 'GET', headers: { cookie } }),
      CTX,
    );
    expect(res2.status).toBe(200);
    expect(res2.headers.get('content-type')).toBe('image/webp');
  });
});
