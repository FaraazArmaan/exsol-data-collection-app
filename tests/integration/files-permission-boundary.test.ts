import { describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import filesHandler from '../../netlify/functions/files';
import detailHandler from '../../netlify/functions/files-detail';
import uploadUrlHandler from '../../netlify/functions/files-upload-url';
import uploadHandler from '../../netlify/functions/files-upload';
import downloadHandler from '../../netlify/functions/files-download-url';
import thumbHandler from '../../netlify/functions/files-thumbnail';

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
const FAKE_ID = '00000000-0000-0000-0000-000000000000';

function noAuth(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

const cases: Array<{ name: string; req: Request; handler: (r: Request, c: Context) => Promise<Response> }> = [
  { name: 'GET /api/files',                   req: noAuth('GET',  'http://x/api/files'),                     handler: filesHandler },
  { name: 'POST /api/files',                  req: noAuth('POST', 'http://x/api/files', {}),                 handler: filesHandler },
  { name: 'GET /api/files-detail/:id',        req: noAuth('GET',  `http://x/api/files-detail/${FAKE_ID}`),   handler: detailHandler },
  { name: 'PATCH /api/files-detail/:id',      req: noAuth('PATCH',`http://x/api/files-detail/${FAKE_ID}`,{}),handler: detailHandler },
  { name: 'DELETE /api/files-detail/:id',     req: noAuth('DELETE',`http://x/api/files-detail/${FAKE_ID}`),  handler: detailHandler },
  { name: 'POST /api/files-upload-url',       req: noAuth('POST', 'http://x/api/files-upload-url', {}),      handler: uploadUrlHandler },
  { name: 'PUT /api/files-upload',            req: noAuth('PUT',  'http://x/api/files-upload?token=x', {}),  handler: uploadHandler },
  { name: 'POST /api/files-download-url',     req: noAuth('POST', 'http://x/api/files-download-url', {}),    handler: downloadHandler },
  { name: 'GET /api/files-thumbnail/:id',     req: noAuth('GET',  `http://x/api/files-thumbnail/${FAKE_ID}`),handler: thumbHandler },
];

describe('files endpoints — unauthenticated', () => {
  for (const c of cases) {
    test(`${c.name} → 401`, async () => {
      const res = await c.handler(c.req, CTX);
      expect(res.status, `${c.name} returned ${res.status}, expected 401`).toBe(401);
    });
  }
});
