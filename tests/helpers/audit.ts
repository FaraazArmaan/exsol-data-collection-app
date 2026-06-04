// Regression-guard helper for audit instrumentation: integration tests call
// `assertLastAudit(sql, {...})` immediately after a happy-path mutation to
// confirm a row landed in public.audit_log with the expected op + target.

import { expect } from 'vitest';
import type { neon } from '@neondatabase/serverless';

export interface ExpectedAudit {
  op: string;
  targetType?: string | null;
  targetId?: string | null;
  actorAdminId?: string | null;
  actorUserNodeId?: string | null;
  clientId?: string | null;
}

export async function assertLastAudit(
  sql: ReturnType<typeof neon>,
  expected: ExpectedAudit,
): Promise<void> {
  // Tests run in parallel — the absolute-latest row may belong to another test
  // file. When the caller knows the targetId (the common case), scope the
  // lookup by (op, target_id) so concurrent inserts don't poison the assertion.
  // When no targetId is supplied, fall back to (op) — still helpful at filtering
  // out other test files' noise.
  const rows = expected.targetId
    ? (await sql`
        SELECT id, op, target_type, target_id, actor_admin, actor_user_node, client_id
        FROM public.audit_log
        WHERE op = ${expected.op} AND target_id = ${expected.targetId}
        ORDER BY id DESC LIMIT 1
      `) as Array<{
        id: number; op: string; target_type: string | null; target_id: string | null;
        actor_admin: string | null; actor_user_node: string | null; client_id: string | null;
      }>
    : (await sql`
        SELECT id, op, target_type, target_id, actor_admin, actor_user_node, client_id
        FROM public.audit_log
        WHERE op = ${expected.op}
        ORDER BY id DESC LIMIT 1
      `) as Array<{
        id: number; op: string; target_type: string | null; target_id: string | null;
        actor_admin: string | null; actor_user_node: string | null; client_id: string | null;
      }>;
  expect(rows.length, 'no audit row found').toBeGreaterThan(0);
  const r = rows[0]!;
  expect(r.op).toBe(expected.op);
  if (expected.targetType !== undefined) expect(r.target_type).toBe(expected.targetType);
  if (expected.targetId !== undefined) expect(r.target_id).toBe(expected.targetId);
  if (expected.actorAdminId !== undefined) expect(r.actor_admin).toBe(expected.actorAdminId);
  if (expected.actorUserNodeId !== undefined) expect(r.actor_user_node).toBe(expected.actorUserNodeId);
  if (expected.clientId !== undefined) expect(r.client_id).toBe(expected.clientId);
}
