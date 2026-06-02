//
// Returns the user_node ids in the subtree rooted at `rootId`, inclusive.
// Implemented as a recursive CTE — single round-trip regardless of depth.
// Used by every endpoint that needs subtree-scoped filtering for the
// 'customers' or 'employees' Data Buckets.

import type { NeonQueryFunction } from '@neondatabase/serverless';

type SQL = NeonQueryFunction<false, false>;

export async function subtreeOf(sql: SQL, rootId: string): Promise<string[]> {
  const rows = (await sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM public.user_nodes WHERE id = ${rootId}::uuid
      UNION ALL
      SELECT n.id FROM public.user_nodes n
      JOIN descendants d ON n.parent_id = d.id
    )
    SELECT id FROM descendants
  `) as { id: string }[];
  return rows.map((r) => r.id);
}
