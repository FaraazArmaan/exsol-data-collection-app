import type { NeonQueryFunction } from '@neondatabase/serverless';

export interface RoleRow {
  id: string;
  client_id: string;
  key: string;
  label: string;
  color: string;
  fields: RoleFieldDef[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RoleFieldDef {
  key: string;
  label: string;
  type: 'text' | 'date' | 'integer' | 'boolean';
  required: boolean;
  default?: string | number | boolean;
  help?: string;
  display_in_list?: boolean;
}

export interface LevelRow {
  id: string;
  client_id: string;
  level_number: number;
  label: string | null;
  allowed_role_ids: string[];
  created_at: string;
}

export interface CardinalityRuleRow {
  id: string;
  client_id: string;
  parent_role_id: string | null;
  child_role_id: string;
  max_children: number;
}

export interface UserNodeRow {
  id: string;
  client_id: string;
  parent_id: string | null;
  level_number: number | null;
  role_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  fields: Record<string, unknown>;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by_admin: string;
}

export interface ClientStructure {
  roles: RoleRow[];
  levels: LevelRow[];
  cardinality_rules: CardinalityRuleRow[];
}

/** Load the full structure for a client in three queries. */
export async function loadStructure(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
): Promise<ClientStructure> {
  const roles = (await sql`
    SELECT id, client_id, key, label, color, fields, sort_order, created_at, updated_at
    FROM public.client_roles WHERE client_id = ${clientId}::uuid
    ORDER BY sort_order, created_at
  `) as RoleRow[];
  const levels = (await sql`
    SELECT id, client_id, level_number, label, allowed_role_ids, created_at
    FROM public.client_levels WHERE client_id = ${clientId}::uuid
    ORDER BY level_number
  `) as LevelRow[];
  const cardinality_rules = (await sql`
    SELECT id, client_id, parent_role_id, child_role_id, max_children
    FROM public.client_cardinality_rules WHERE client_id = ${clientId}::uuid
    ORDER BY parent_role_id NULLS FIRST, child_role_id
  `) as CardinalityRuleRow[];
  return { roles, levels, cardinality_rules };
}

/**
 * Walk ancestor chain from `targetParentId` upward; throw cycle_detected
 * if `movingNodeId` appears in the chain. Returns when reaching a NULL parent.
 */
export async function cycleCheck(
  sql: NeonQueryFunction<false, false>,
  movingNodeId: string,
  targetParentId: string | null,
): Promise<void> {
  if (targetParentId === null) return;
  let current: string | null = targetParentId;
  const seen = new Set<string>();
  while (current !== null) {
    if (current === movingNodeId) throw new Error('cycle_detected');
    if (seen.has(current)) throw new Error('cycle_detected'); // defensive
    seen.add(current);
    const rows = (await sql`
      SELECT parent_id FROM public.user_nodes WHERE id = ${current}::uuid LIMIT 1
    `) as { parent_id: string | null }[];
    if (rows.length === 0) throw new Error('parent_not_found');
    current = rows[0]!.parent_id;
  }
}

/**
 * Look up the cardinality cap for placing `childRoleId` under a parent of
 * `parentRoleId` (null = top-level). Returns null if no rule defined (= unlimited).
 */
export async function getCardinalityCap(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  parentRoleId: string | null,
  childRoleId: string,
): Promise<number | null> {
  const rows = (await sql`
    SELECT max_children
    FROM public.client_cardinality_rules
    WHERE client_id = ${clientId}::uuid
      AND child_role_id = ${childRoleId}::uuid
      AND (
        (parent_role_id IS NULL AND ${parentRoleId === null}::boolean) OR
        parent_role_id = ${parentRoleId}::uuid
      )
    LIMIT 1
  `) as { max_children: number }[];
  return rows[0]?.max_children ?? null;
}
