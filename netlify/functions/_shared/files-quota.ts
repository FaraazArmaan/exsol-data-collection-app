// Per-client storage-quota helpers for the File Manager.
//
// Authoritative usage is always SUM(byte_size) over non-deleted files; the
// workspace_storage_quota.bytes_used_cached column is a denormalised copy kept
// fresh on every upload commit, used only for the header meter to avoid an
// aggregate query on each page load.

import type { NeonQueryFunction } from '@neondatabase/serverless';

type SQL = NeonQueryFunction<false, false>;

export const DEFAULT_BYTE_LIMIT = 5368709120; // 5 GB

/** Returns the client's byte_limit, creating a default row if none exists. */
export async function getByteLimit(sql: SQL, clientId: string): Promise<number> {
  const rows = (await sql`
    INSERT INTO public.workspace_storage_quota (client_id)
    VALUES (${clientId}::uuid)
    ON CONFLICT (client_id) DO UPDATE SET client_id = EXCLUDED.client_id
    RETURNING byte_limit
  `) as { byte_limit: string }[];
  return Number(rows[0]!.byte_limit);
}

/** Recomputes authoritative usage, writes it to bytes_used_cached, returns it. */
export async function recomputeUsage(sql: SQL, clientId: string): Promise<number> {
  const agg = (await sql`
    SELECT COALESCE(SUM(byte_size), 0)::bigint AS s
    FROM public.files
    WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL
  `) as { s: string }[];
  const used = Number(agg[0]!.s);
  await sql`
    INSERT INTO public.workspace_storage_quota (client_id, bytes_used_cached, updated_at)
    VALUES (${clientId}::uuid, ${used}, now())
    ON CONFLICT (client_id)
    DO UPDATE SET bytes_used_cached = ${used}, updated_at = now()
  `;
  return used;
}

export async function getQuota(
  sql: SQL,
  clientId: string,
): Promise<{ byte_limit: number; bytes_used: number }> {
  const byte_limit = await getByteLimit(sql, clientId);
  const bytes_used = await recomputeUsage(sql, clientId);
  return { byte_limit, bytes_used };
}

/** True when current authoritative usage + incomingBytes would exceed the limit. */
export async function wouldExceed(sql: SQL, clientId: string, incomingBytes: number): Promise<boolean> {
  const { byte_limit, bytes_used } = await getQuota(sql, clientId);
  return bytes_used + Math.max(0, incomingBytes) > byte_limit;
}
