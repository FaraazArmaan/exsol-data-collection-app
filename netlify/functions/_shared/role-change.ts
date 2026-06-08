// Shared validators for single-user and bulk role-change endpoints.
// Lifted from user-nodes-bulk-role-change.ts to keep validation identical
// across both code paths. No new behavior here.

import type { neon } from '@neondatabase/serverless';

type SQL = ReturnType<typeof neon>;

export interface LevelAllowsRoleOk { ok: true }
export interface LevelAllowsRoleFail { ok: false; code: 'level_disallows_role' }
export type LevelAllowsRoleResult = LevelAllowsRoleOk | LevelAllowsRoleFail;

/**
 * Returns ok when the new role is in `client_levels.allowed_role_ids` for the
 * given level. Caller is expected to have already verified the role belongs
 * to the client.
 */
export async function validateLevelAllowsRole(
  sql: SQL,
  clientId: string,
  levelNumber: number,
  newRoleId: string,
): Promise<LevelAllowsRoleResult> {
  const rows = (await sql`
    SELECT allowed_role_ids FROM public.client_levels
    WHERE client_id = ${clientId}::uuid AND level_number = ${levelNumber}
    LIMIT 1
  `) as { allowed_role_ids: string[] }[];
  if (rows.length === 0 || !rows[0]!.allowed_role_ids.includes(newRoleId)) {
    return { ok: false, code: 'level_disallows_role' };
  }
  return { ok: true };
}

export interface CardinalityOk { ok: true }
export interface CardinalityFail { ok: false; code: 'cardinality_exceeded'; max: number }
export type CardinalityResult = CardinalityOk | CardinalityFail;

/**
 * Project the per-parent count of `newRoleId` after the role change and
 * compare to the configured cap. Returns ok if no rule applies. The
 * `currentRoleId` argument is used to avoid double-counting a target that
 * is already in the new-role cohort under the same parent.
 */
export async function validateCardinality(
  sql: SQL,
  clientId: string,
  parentId: string | null,
  newRoleId: string,
  currentRoleId: string,
): Promise<CardinalityResult> {
  // Fetch the rule for (parent_role_id, new_role_id). parent_role_id is
  // resolved from parentId; root-level uses null.
  let parentRoleId: string | null = null;
  if (parentId !== null) {
    const r = (await sql`
      SELECT role_id FROM public.user_nodes WHERE id = ${parentId}::uuid LIMIT 1
    `) as { role_id: string }[];
    if (r.length === 0) return { ok: true }; // parent vanished — caller will fail elsewhere
    parentRoleId = r[0]!.role_id;
  }
  const rules = (await sql`
    SELECT max_children FROM public.client_cardinality_rules
    WHERE client_id = ${clientId}::uuid
      AND child_role_id = ${newRoleId}::uuid
      AND (
        (parent_role_id IS NULL AND ${parentRoleId === null}::boolean)
        OR parent_role_id = ${parentRoleId}::uuid
      )
    LIMIT 1
  `) as { max_children: number }[];
  if (rules.length === 0) return { ok: true };
  const cap = rules[0]!.max_children;

  // Existing count of newRoleId under this parent.
  const counts = (await sql`
    SELECT count(*)::int AS c FROM public.user_nodes
    WHERE client_id = ${clientId}::uuid
      AND role_id = ${newRoleId}::uuid
      AND (
        (parent_id IS NULL AND ${parentId === null}::boolean)
        OR parent_id = ${parentId}::uuid
      )
  `) as { c: number }[];
  const existing = counts[0]?.c ?? 0;
  // If the target is already in the new-role cohort under this parent,
  // the change is a no-op and shouldn't increase the count.
  const wasCounted = currentRoleId === newRoleId ? 1 : 0;
  const projected = existing - wasCounted + 1;
  if (projected > cap) return { ok: false, code: 'cardinality_exceeded', max: cap };
  return { ok: true };
}
