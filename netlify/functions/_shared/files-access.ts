// File Manager access helpers.
//
// Responsibilities:
//   - assertCanWrite — bucket-user write block (per spec §7.2). L1 Owner override.
//   - isL1Owner — single predicate used by both tier-cap and visibility skip.
//   - composeTierVisibilityClause — builds the per-file ACL WHERE clause.
//
// The visibility clause walks ancestors UPWARD from the user's node (bounded
// by tree depth) rather than subtrees DOWNWARD from N restricted-roots
// (unbounded). See spec §4.8.

import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { AnySession } from './permissions';
import { ForbiddenError } from './permissions';

type SQL = NeonQueryFunction<false, false>;

export type FilesAccessSession = AnySession;

export function isL1Owner(session: FilesAccessSession): boolean {
  return session.kind === 'bucket_user' && session.level_number === 1;
}

/**
 * Throws ForbiddenError when a bucket-family user (external customer/employee)
 * attempts a write path. Admin and internal workspace users (bucket_family IS NULL)
 * pass. L1 Owner always passes regardless of role's bucket_family (defensive).
 */
export async function assertCanWrite(sql: SQL, session: FilesAccessSession): Promise<void> {
  if (session.kind === 'admin') return;
  if (session.level_number === 1) return; // L1 Owner bypass
  const rows = (await sql`
    SELECT cr.bucket_family
    FROM public.user_nodes un
    JOIN public.client_roles cr ON cr.id = un.role_id
    WHERE un.id = ${session.user_node_id}::uuid
    LIMIT 1
  `) as { bucket_family: string | null }[];
  if (rows.length === 0 || rows[0]!.bucket_family !== null) {
    throw new ForbiddenError('files.read_only_for_bucket_users');
  }
}

export interface VisibilityValues {
  skipClause: boolean;
  userNodeId: string | null;
  roleId: string | null;
}

/**
 * Returns the parameter set the endpoint passes to the visibility clause.
 * When skipClause is true, the endpoint omits the WHERE clause entirely
 * (admin reading vault, or L1 Owner reading workspace files).
 *
 * Endpoints fetch role_id once per request — pass it in via the optional arg
 * to avoid an extra round-trip when already known.
 */
export function visibilityValues(
  session: FilesAccessSession,
  roleId?: string | null,
): VisibilityValues {
  if (session.kind === 'admin' || isL1Owner(session)) {
    return { skipClause: true, userNodeId: null, roleId: null };
  }
  return {
    skipClause: false,
    userNodeId: session.user_node_id,
    roleId: roleId ?? null,
  };
}

// Backwards-compatible alias used by the test.
export const visibleFilesClauseValues = visibilityValues;

/**
 * Build the SQL fragment for tier visibility. The endpoint composes this
 * with its own SELECT/WHERE shape.
 *
 *   Use with neon serverless: pass through `sql.fragment` style via a string
 *   template — endpoints inject the values inline using parameterised neon
 *   tagged templates. See files.ts (list endpoint) for the call site.
 *
 * The returned string contains $1, $2 placeholders for the user_node_id and
 * role_id; endpoints expand those via the neon helper. Direct concatenation
 * of user input into this string is NEVER permitted.
 */
export const TIER_VISIBILITY_CLAUSE = `
  files.deleted_at IS NULL AND (
    files.tier = 'public'
    OR (files.tier = 'role' AND EXISTS (
          SELECT 1 FROM public.file_allowed_roles fr
          WHERE fr.file_id = files.id AND fr.role_id = $2::uuid))
    OR (files.tier = 'restricted' AND EXISTS (
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM public.user_nodes WHERE id = $1::uuid
            UNION ALL
            SELECT n.id, n.parent_id FROM public.user_nodes n
            JOIN ancestors a ON n.id = a.parent_id
          )
          SELECT 1 FROM public.file_allowed_nodes fn
          WHERE fn.file_id = files.id AND fn.node_id IN (SELECT id FROM ancestors)))
    OR (files.tier = 'confidential' AND EXISTS (
          SELECT 1 FROM public.file_allowed_users fu
          WHERE fu.file_id = files.id AND fu.user_node_id = $1::uuid))
  )
`;

/**
 * Resolve the workspace user's role_id once per request.
 * Returns null for admin sessions.
 */
export async function resolveRoleId(sql: SQL, session: FilesAccessSession): Promise<string | null> {
  if (session.kind === 'admin') return null;
  const rows = (await sql`
    SELECT role_id FROM public.user_nodes WHERE id = ${session.user_node_id}::uuid LIMIT 1
  `) as { role_id: string | null }[];
  return rows[0]?.role_id ?? null;
}
