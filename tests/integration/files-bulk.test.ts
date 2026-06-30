import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import bulkHandler from '../../netlify/functions/files-bulk';
import { seedClientWithProductsEnabled, makeBucketUserRequest, type PosTestCtx } from '../pos/_helpers';

const CTX = {} as Context;
let sql: ReturnType<typeof neon>;
let ctx: PosTestCtx;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  ctx = await seedClientWithProductsEnabled();
});

afterAll(async () => {
  await sql`DELETE FROM public.files WHERE client_id = ${ctx.clientId}::uuid`;
});

async function seedFile(title: string): Promise<string> {
  const r = (await sql`
    INSERT INTO public.files (client_id, type, storage_kind, blob_key, title, tier, uploaded_by_user_node, byte_size)
    VALUES (${ctx.clientId}::uuid, 'document', 'blob', ${'k-' + title + '-' + Math.random()}, ${title}, 'public', ${ctx.userNodeId}::uuid, 10)
    RETURNING id
  `) as { id: string }[];
  return r[0]!.id;
}

describe('POST /api/files-bulk', () => {
  test('soft_delete sets deleted_at and reports ok count', async () => {
    const a = await seedFile('bulk-a');
    const b = await seedFile('bulk-b');
    const res = await bulkHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/files-bulk', { action: 'soft_delete', file_ids: [a, b] }),
      CTX,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).result_counts.ok).toBe(2);
    const rows = (await sql`SELECT deleted_at FROM public.files WHERE id IN (${a}::uuid, ${b}::uuid)`) as { deleted_at: string | null }[];
    expect(rows.every((r) => r.deleted_at !== null)).toBe(true);
  });

  test('restore clears deleted_at', async () => {
    const a = await seedFile('bulk-r');
    await sql`UPDATE public.files SET deleted_at = now() WHERE id = ${a}::uuid`;
    const res = await bulkHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/files-bulk', { action: 'restore', file_ids: [a] }),
      CTX,
    );
    expect((await res.json()).result_counts.ok).toBe(1);
    const rows = (await sql`SELECT deleted_at FROM public.files WHERE id = ${a}::uuid`) as { deleted_at: string | null }[];
    expect(rows[0]!.deleted_at).toBeNull();
  });

  test('change_tier to role updates tier and replaces audience', async () => {
    const a = await seedFile('bulk-tier');
    const res = await bulkHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/files-bulk', { action: 'change_tier', file_ids: [a], tier: 'role', allowed_role_ids: [] }),
      CTX,
    );
    expect((await res.json()).result_counts.ok).toBe(1);
    const rows = (await sql`SELECT tier FROM public.files WHERE id = ${a}::uuid`) as { tier: string }[];
    expect(rows[0]!.tier).toBe('role');
  });

  test('add_category inserts the join row idempotently', async () => {
    const a = await seedFile('bulk-c');
    const res = await bulkHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/files-bulk', { action: 'add_category', file_ids: [a], category: 'hr_payroll' }),
      CTX,
    );
    expect((await res.json()).result_counts.ok).toBe(1);
    const rows = (await sql`SELECT 1 FROM public.file_categories WHERE file_id = ${a}::uuid AND category_key = 'hr_payroll'`) as unknown[];
    expect(rows).toHaveLength(1);
  });

  test('empty file_ids → 400 bulk_empty', async () => {
    const res = await bulkHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/files-bulk', { action: 'soft_delete', file_ids: [] }),
      CTX,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('bulk_empty');
  });

  test('files outside the caller client are skipped, not errored', async () => {
    const res = await bulkHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/files-bulk', { action: 'soft_delete', file_ids: ['00000000-0000-0000-0000-000000000000'] }),
      CTX,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).result_counts.ok).toBe(0);
  });
});
