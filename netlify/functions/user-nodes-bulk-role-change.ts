// netlify/functions/user-nodes-bulk-role-change.ts
//
// POST /api/user-nodes-bulk-role-change — admin or owner.
// All-or-nothing: pre-validate every target (level/role compat + cardinality
// post-change), then run one sql.transaction([... UPDATEs]). For L2+
// bucket-user callers, also verify every target sits in the caller's subtree.
//
// Spec: docs/superpowers/specs/2026-06-04-bulk-operations-design.md §4.3.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import {
  authenticateForPermission, resolveClientIdOrRespond,
  type AnySession,
} from './_shared/permissions';
import { subtreeOf } from './_shared/subtree';
import { jsonError, jsonOk } from './_shared/http';
import { logAudit } from './_shared/audit';

const Body = z.object({
  node_ids: z.array(z.string().uuid()),
  new_role_id: z.string().uuid(),
});

interface TargetError { node_id: string; reason: string }

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const auth = await authenticateForPermission(req, '_platform.users.edit');
  if (auth instanceof Response) return auth;
  const session: AnySession = auth;

  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const clientId = scope.clientId;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const { node_ids, new_role_id } = parsed.data;
  if (node_ids.length > 500) return jsonError(400, 'too_many_rows');
  if (node_ids.length === 0) return jsonError(400, 'empty_payload');

  const sql = db();

  // Fetch the new role; assert it's in this client.
  const newRoleRows = (await sql`
    SELECT id, client_id, key FROM public.client_roles WHERE id = ${new_role_id}::uuid LIMIT 1
  `) as { id: string; client_id: string; key: string }[];
  if (newRoleRows.length === 0) return jsonError(404, 'not_found');
  if (newRoleRows[0]!.client_id !== clientId) return jsonError(400, 'cross_client');
  const newRoleKey = newRoleRows[0]!.key;

  // Fetch all targets.
  const targets = (await sql`
    SELECT id, client_id, parent_id, level_number, role_id
    FROM public.user_nodes WHERE id = ANY(${node_ids}::uuid[])
  `) as { id: string; client_id: string; parent_id: string | null; level_number: number | null; role_id: string }[];

  // Missing target IDs?
  const foundIds = new Set(targets.map((t) => t.id));
  for (const nid of node_ids) {
    if (!foundIds.has(nid)) return jsonError(400, 'cross_client'); // intentional: unknown id == cross-client from caller's view
  }
  // Any target in a different client?
  for (const t of targets) {
    if (t.client_id !== clientId) return jsonError(400, 'cross_client');
  }

  // Subtree scope for L2+ bucket-user callers — every target must be inside subtree.
  // Hoist the recursive CTE: run once, then check membership in O(1) per target.
  if (session.kind === 'bucket_user' && session.level_number > 1) {
    const allowed = new Set(await subtreeOf(sql, session.user_node_id));
    for (const t of targets) {
      if (!allowed.has(t.id)) return jsonError(403, 'forbidden');
    }
  }

  // Old role keys (for audit detail).
  const allRoleIds = Array.from(new Set([...targets.map((t) => t.role_id), new_role_id]));
  const roleRows = (await sql`
    SELECT id, key FROM public.client_roles WHERE id = ANY(${allRoleIds}::uuid[])
  `) as { id: string; key: string }[];
  const roleKeyById = new Map(roleRows.map((r) => [r.id, r.key]));
  const fromRoleKeysUnique = Array.from(new Set(
    targets.map((t) => roleKeyById.get(t.role_id) ?? t.role_id),
  ));

  // Level allowed-roles for each level present in the target set.
  const distinctLevels = Array.from(new Set(targets.map((t) => t.level_number).filter((n): n is number => n !== null)));
  const levels = distinctLevels.length === 0 ? [] : (await sql`
    SELECT level_number, allowed_role_ids FROM public.client_levels
    WHERE client_id = ${clientId}::uuid AND level_number = ANY(${distinctLevels}::int[])
  `) as { level_number: number; allowed_role_ids: string[] }[];
  const levelByNumber = new Map(levels.map((l) => [l.level_number, l]));

  // Cardinality rules.
  const rules = (await sql`
    SELECT parent_role_id, child_role_id, max_children
    FROM public.client_cardinality_rules WHERE client_id = ${clientId}::uuid AND child_role_id = ${new_role_id}::uuid
  `) as { parent_role_id: string | null; child_role_id: string; max_children: number }[];
  function capFor(parentRoleId: string | null): number | null {
    for (const r of rules) {
      const m = (r.parent_role_id === null && parentRoleId === null)
        || (r.parent_role_id !== null && r.parent_role_id === parentRoleId);
      if (m) return r.max_children;
    }
    return null;
  }

  // Existing count of new_role_id under each parent (parent_id key, or 'root').
  const existingCounts = new Map<string, number>();
  if (rules.length > 0) {
    const rows = (await sql`
      SELECT parent_id, count(*)::int AS c
      FROM public.user_nodes
      WHERE client_id = ${clientId}::uuid AND role_id = ${new_role_id}::uuid
      GROUP BY parent_id
    `) as { parent_id: string | null; c: number }[];
    for (const r of rows) existingCounts.set(r.parent_id ?? 'root', r.c);
  }

  // Batch-fetch parent role_ids once (avoids N+1 SELECTs in the loop below).
  const parentIds = [...new Set(targets.map((t) => t.parent_id).filter((x): x is string => x !== null))];
  const parentRows = parentIds.length > 0 ? (await sql`
    SELECT id, role_id FROM public.user_nodes WHERE id = ANY(${parentIds}::uuid[])
  `) as { id: string; role_id: string }[] : [];
  const parentRoleById = new Map(parentRows.map((r) => [r.id, r.role_id]));

  // Per-target validation pass.
  const errors: TargetError[] = [];
  const deltas = new Map<string, number>(); // pending changes to count toward cap
  for (const t of targets) {
    // Level allows the new role?
    if (t.level_number !== null) {
      const lv = levelByNumber.get(t.level_number);
      if (!lv || !lv.allowed_role_ids.includes(new_role_id)) {
        errors.push({ node_id: t.id, reason: `Role not allowed at level ${t.level_number}` });
        continue;
      }
    }
    // Parent's role id for cardinality (from batch lookup).
    const parentRoleId: string | null = t.parent_id !== null
      ? parentRoleById.get(t.parent_id) ?? null
      : null;
    const cap = capFor(parentRoleId);
    if (cap !== null) {
      const key = t.parent_id ?? 'root';
      // Was this target already counted? If its current role_id is new_role_id, this is a no-op move within the same cohort.
      const wasCounted = t.role_id === new_role_id ? 1 : 0;
      const projected = (existingCounts.get(key) ?? 0) - wasCounted + (deltas.get(key) ?? 0) + 1;
      if (projected > cap) {
        errors.push({ node_id: t.id, reason: `Cardinality exceeded (max ${cap})` });
        continue;
      }
      deltas.set(key, (deltas.get(key) ?? 0) + 1 - wasCounted);
    }
  }

  if (errors.length > 0) return jsonError(400, 'bulk_validation_failed', { errors });

  // Commit in one transaction.
  const queries = targets.map((t) => sql`
    UPDATE public.user_nodes SET role_id = ${new_role_id}::uuid, updated_at = now()
    WHERE id = ${t.id}::uuid
  `);
  await sql.transaction(queries as never);

  await logAudit(sql, {
    session,
    op: 'users.bulk_role_changed',
    clientId,
    targetType: 'client_role',
    targetId: new_role_id,
    detail: {
      count: targets.length,
      from_role_keys: fromRoleKeysUnique,
      to_role_key: newRoleKey,
      target_ids: targets.map((t) => t.id),
    },
  });

  return jsonOk({ updated: targets.length });
};
