import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { authenticateForPermission, authorizeClientScope } from './_shared/permissions';
import { subtreeOf } from './_shared/subtree';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { cycleCheck, getCardinalityCap } from './_shared/user-tree';
import { logAudit } from './_shared/audit';

const Body = z.object({
  parent_id: z.string().uuid().nullable(),
  level_number: z.number().int().positive().nullable(),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const auth = await authenticateForPermission(req, '_platform.users.edit');
  if (auth instanceof Response) return auth;
  const session = auth;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(id, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const { parent_id: newParent, level_number: newLevel } = parsed.data;

  const sql = db();

  // Load the moving node + (optionally) the new parent.
  const nodeRows = (await sql`
    SELECT id, client_id, parent_id, level_number, role_id
    FROM public.user_nodes WHERE id = ${id}::uuid LIMIT 1
  `) as { id: string; client_id: string; parent_id: string | null; level_number: number | null; role_id: string }[];
  if (nodeRows.length === 0) return jsonError(404, 'not_found');
  const node = nodeRows[0]!;

  const scope = authorizeClientScope(session, node.client_id);
  if ('error' in scope) return jsonError(403, scope.error);
  // Both the moved node AND (if set) the new parent must be in the caller's
  // subtree — you can't reach into someone else's subtree to move people,
  // and you can't reparent under someone you don't manage. Unassigning
  // (parent=null) skips the parent check because that's stripping access
  // within the caller's own subtree. Admin and L1 bypass both checks.
  // One subtreeOf round-trip serves both membership checks.
  if (session.kind === 'bucket_user' && session.level_number > 1) {
    const allowed = await subtreeOf(sql, session.user_node_id);
    if (!allowed.includes(node.id)) return jsonError(403, 'forbidden_subtree');
    if (newParent !== null && !allowed.includes(newParent)) {
      return jsonError(403, 'forbidden_subtree');
    }
  }

  // Case 1: moving to unassigned. The CHECK constraint requires unassigned nodes
  // to have NULL parent_id as well, so we flatten the entire subtree: every node
  // in the subtree becomes (parent_id=NULL, level_number=NULL).
  if (newParent === null && newLevel === null) {
    // Materialize the descendant id list first while parents are still intact.
    const subtreeRows = (await sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM public.user_nodes WHERE id = ${id}::uuid
        UNION ALL
        SELECT n.id FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
      )
      SELECT id FROM subtree
    `) as { id: string }[];
    const subtreeIds = subtreeRows.map((r) => r.id);
    // Null parents bottom-up to keep the trigger happy: descendants first.
    // Easiest: null parent + level for every node in the subtree in a single statement
    // — order doesn't matter because we're setting both to NULL, and the trigger only
    // rejects (parent_id IS NOT NULL AND level mismatch) configurations.
    await sql`
      UPDATE public.user_nodes
      SET parent_id = NULL, level_number = NULL
      WHERE id = ANY(${subtreeIds}::uuid[])
    `;
    await logAudit(sql, {
      session,
      op: 'user_node.moved',
      clientId: node.client_id,
      targetType: 'user_node',
      targetId: id,
      detail: { new_parent_id: newParent, new_level_number: newLevel },
    });
    return jsonOk({ ok: true, moved_to: 'unassigned' });
  }

  // Case 2: moving to top-level (parent=null, level=1).
  if (newParent === null) {
    if (newLevel !== 1) return jsonError(400, 'top_level_requires_level_1');
    // Cardinality + advisory lock.
    const cap = await getCardinalityCap(sql, node.client_id, null, node.role_id);
    if (cap !== null) {
      // Run in transaction.
      const result = await sql.transaction([
        sql`SELECT pg_advisory_xact_lock(hashtext(${node.client_id} || ':' || ${node.role_id}))`,
        sql`SELECT count(*)::int AS c FROM public.user_nodes
            WHERE client_id = ${node.client_id}::uuid AND parent_id IS NULL AND role_id = ${node.role_id}::uuid
              AND id <> ${id}::uuid`,
      ] as never);
      const arr = result as unknown as unknown[][];
      const countRow = arr[1] as { c: number }[];
      if (countRow[0]!.c >= cap) return jsonError(409, 'cardinality_exceeded', { max: cap });
    }

    const oldLevel = node.level_number;
    const delta = oldLevel === null ? null : (1 - oldLevel);

    // Move the node first to satisfy parent/level consistency.
    await sql`
      UPDATE public.user_nodes SET parent_id = NULL, level_number = 1
      WHERE id = ${id}::uuid
    `;

    if (delta !== null && delta !== 0) {
      await sql`
        WITH RECURSIVE subtree AS (
          SELECT id FROM public.user_nodes WHERE id = ${id}::uuid
          UNION ALL
          SELECT n.id FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
        )
        UPDATE public.user_nodes SET level_number = level_number + ${delta}
        WHERE id IN (SELECT id FROM subtree WHERE id <> ${id}::uuid) AND level_number IS NOT NULL
      `;
    }

    // If subtree was previously unassigned (delta null), re-assign descendants relative to new level=1.
    if (delta === null) {
      await sql`
        WITH RECURSIVE subtree(id, depth) AS (
          SELECT id, 0 FROM public.user_nodes WHERE id = ${id}::uuid
          UNION ALL
          SELECT n.id, s.depth + 1 FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
        )
        UPDATE public.user_nodes SET level_number = 1 + s.depth
        FROM subtree s WHERE public.user_nodes.id = s.id AND public.user_nodes.id <> ${id}::uuid
      `;
    }

    const rows = (await sql`
      SELECT id, client_id, parent_id, level_number, role_id, display_name
      FROM public.user_nodes WHERE id = ${id}::uuid
    `) as unknown[];
    await logAudit(sql, {
      session,
      op: 'user_node.moved',
      clientId: node.client_id,
      targetType: 'user_node',
      targetId: id,
      detail: { new_parent_id: newParent, new_level_number: newLevel },
    });
    return jsonOk({ node: rows[0] });
  }

  // Case 3: moving under a parent.
  const parentRows = (await sql`
    SELECT id, client_id, level_number, role_id FROM public.user_nodes WHERE id = ${newParent}::uuid LIMIT 1
  `) as { id: string; client_id: string; level_number: number | null; role_id: string }[];
  if (parentRows.length === 0) return jsonError(404, 'parent_not_found');
  if (parentRows[0]!.client_id !== node.client_id) return jsonError(400, 'cross_client_parent');
  if (parentRows[0]!.level_number === null) return jsonError(400, 'parent_unassigned');
  if (newLevel !== parentRows[0]!.level_number + 1) return jsonError(400, 'parent_level_mismatch');

  // Cycle check.
  try { await cycleCheck(sql, id, newParent); }
  catch (e) {
    if ((e as Error).message === 'cycle_detected') return jsonError(400, 'cycle_detected');
    throw e;
  }

  // Cardinality check.
  const cap = await getCardinalityCap(sql, node.client_id, parentRows[0]!.role_id, node.role_id);
  if (cap !== null) {
    const result = await sql.transaction([
      sql`SELECT 1 FROM public.user_nodes WHERE id = ${newParent}::uuid FOR UPDATE`,
      sql`SELECT count(*)::int AS c FROM public.user_nodes
          WHERE parent_id = ${newParent}::uuid AND role_id = ${node.role_id}::uuid
            AND id <> ${id}::uuid`,
    ] as never);
    const arr = result as unknown as unknown[][];
    const countRow = arr[1] as { c: number }[];
    if (countRow[0]!.c >= cap) return jsonError(409, 'cardinality_exceeded', { max: cap });
  }

  // Descendant relevel.
  const oldLevel = node.level_number;
  const delta = oldLevel === null ? null : (newLevel - oldLevel);

  // Move the node first.
  await sql`
    UPDATE public.user_nodes SET parent_id = ${newParent}::uuid, level_number = ${newLevel}
    WHERE id = ${id}::uuid
  `;

  if (delta !== null && delta !== 0) {
    await sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM public.user_nodes WHERE id = ${id}::uuid
        UNION ALL
        SELECT n.id FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
      )
      UPDATE public.user_nodes SET level_number = level_number + ${delta}
      WHERE id IN (SELECT id FROM subtree WHERE id <> ${id}::uuid) AND level_number IS NOT NULL
    `;
  }
  if (delta === null) {
    await sql`
      WITH RECURSIVE subtree(id, depth) AS (
        SELECT id, 0 FROM public.user_nodes WHERE id = ${id}::uuid
        UNION ALL
        SELECT n.id, s.depth + 1 FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
      )
      UPDATE public.user_nodes SET level_number = ${newLevel} + s.depth
      FROM subtree s WHERE public.user_nodes.id = s.id AND public.user_nodes.id <> ${id}::uuid
    `;
  }

  const rows = (await sql`
    SELECT id, client_id, parent_id, level_number, role_id, display_name
    FROM public.user_nodes WHERE id = ${id}::uuid
  `) as unknown[];
  await logAudit(sql, {
    session,
    op: 'user_node.moved',
    clientId: node.client_id,
    targetType: 'user_node',
    targetId: id,
    detail: { new_parent_id: newParent, new_level_number: newLevel },
  });
  return jsonOk({ node: rows[0] });
};
