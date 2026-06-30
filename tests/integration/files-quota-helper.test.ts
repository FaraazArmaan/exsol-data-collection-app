import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { getByteLimit, recomputeUsage, getQuota, wouldExceed } from '../../netlify/functions/_shared/files-quota';

let sql: ReturnType<typeof neon>;
let clientId: string | null = null;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const c = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
  clientId = c[0]?.id ?? null;
});

afterAll(async () => {
  if (clientId) await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${clientId}::uuid`;
});

describe('files-quota helper', () => {
  test('getByteLimit auto-creates a default 5 GB row', async () => {
    if (!clientId) return;
    await sql`DELETE FROM public.workspace_storage_quota WHERE client_id = ${clientId}::uuid`;
    const limit = await getByteLimit(sql as never, clientId);
    expect(limit).toBe(5368709120);
  });

  test('recomputeUsage equals SUM(byte_size) of non-deleted files', async () => {
    if (!clientId) return;
    const expected = (await sql`
      SELECT COALESCE(SUM(byte_size), 0)::bigint AS s
      FROM public.files WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL
    `) as { s: string }[];
    const used = await recomputeUsage(sql as never, clientId);
    expect(used).toBe(Number(expected[0]!.s));
  });

  test('getQuota returns both limit and authoritative usage', async () => {
    if (!clientId) return;
    const q = await getQuota(sql as never, clientId);
    expect(q.byte_limit).toBe(5368709120);
    expect(typeof q.bytes_used).toBe('number');
  });

  test('wouldExceed is true past the limit, false under it', async () => {
    if (!clientId) return;
    expect(await wouldExceed(sql as never, clientId, 1)).toBe(false);
    expect(await wouldExceed(sql as never, clientId, 5368709120 + 1)).toBe(true);
  });
});
