import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import uploadUrlHandler from '../../netlify/functions/files-upload-url';
import { seedClientWithProductsEnabled, makeBucketUserRequest, type PosTestCtx } from '../pos/_helpers';

const CTX = {} as Context;
let sql: ReturnType<typeof neon>;
let ctx: PosTestCtx;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  ctx = await seedClientWithProductsEnabled();
});

afterAll(async () => {
  await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${ctx.clientId}::uuid`;
});

describe('quota enforcement at reservation', () => {
  test('reservation rejected with 413 when byte_size alone exceeds the limit', async () => {
    await sql`
      INSERT INTO public.workspace_storage_quota (client_id, byte_limit)
      VALUES (${ctx.clientId}::uuid, 100)
      ON CONFLICT (client_id) DO UPDATE SET byte_limit = 100
    `;
    try {
      const res = await uploadUrlHandler(
        makeBucketUserRequest(ctx, 'POST', '/api/files-upload-url', {
          filename: 'big.pdf', mime: 'application/pdf', byte_size: 10_000,
        }),
        CTX,
      );
      expect(res.status).toBe(413);
      expect((await res.json()).error.code).toBe('quota_exceeded');
    } finally {
      await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${ctx.clientId}::uuid`;
    }
  });

  test('reservation succeeds under the limit (default 5 GB)', async () => {
    const res = await uploadUrlHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/files-upload-url', {
        filename: 'ok.pdf', mime: 'application/pdf', byte_size: 10,
      }),
      CTX,
    );
    expect(res.status).toBe(200);
  });
});
