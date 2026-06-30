import { beforeAll, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import quotaHandler from '../../netlify/functions/files-quota';
import bulkHandler from '../../netlify/functions/files-bulk';
import { seedClientWithProductsEnabled, makeBucketUserRequest, type PosTestCtx } from '../pos/_helpers';

const CTX = {} as Context;
let sql: ReturnType<typeof neon>;
let ctx: PosTestCtx;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  ctx = await seedClientWithProductsEnabled();
});

describe('files-quota PATCH is admin-only', () => {
  test('workspace user PATCH → 403 (not 404/500)', async () => {
    const res = await quotaHandler(
      makeBucketUserRequest(ctx, 'PATCH', '/api/files-quota', { client_id: ctx.clientId, byte_limit: 1 }),
      CTX,
    );
    expect(res.status).toBe(403);
  });
});

describe('files-bulk auth', () => {
  test('unauthenticated → 401', async () => {
    const res = await bulkHandler(
      new Request('http://localhost/api/files-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'soft_delete', file_ids: ['00000000-0000-0000-0000-000000000000'] }),
      }),
      CTX,
    );
    expect(res.status).toBe(401);
  });

  test('bad action → 400 bulk_action_invalid (not 500)', async () => {
    const res = await bulkHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/files-bulk', { action: 'nuke', file_ids: ['00000000-0000-0000-0000-000000000000'] }),
      CTX,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('bulk_action_invalid');
  });
});
