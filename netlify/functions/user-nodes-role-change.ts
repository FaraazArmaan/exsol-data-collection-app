// netlify/functions/user-nodes-role-change.ts
//
// POST /api/user-nodes-role-change — admin or L1 Owner.
// Single-user variant of user-nodes-bulk-role-change.ts with a stricter
// permission gate (L2+ bucket-user rejected) and self-target block.
//
// Spec: docs/superpowers/specs/2026-06-08-edit-modal-role-change-design.md

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import {
  authenticateForPermission, resolveClientIdOrRespond,
  type AnySession,
} from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { logAudit } from './_shared/audit';
import { validateCardinality } from './_shared/role-change';

const Body = z.object({
  node_id: z.string().uuid(),
  new_role_id: z.string().uuid(),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const auth = await authenticateForPermission(req, '_platform.users.edit');
  if (auth instanceof Response) return auth;
  const session: AnySession = auth;

  // Gate: admin OR L1 only.
  if (session.kind === 'bucket_user' && session.level_number > 1) {
    return jsonError(403, 'forbidden_role_change_scope');
  }

  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const clientId = scope.clientId;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const { node_id, new_role_id } = parsed.data;

  const sql = db();

  // Fetch target + new role.
  const [target] = (await sql`
    SELECT id, client_id, parent_id, level_number, role_id, display_name
    FROM public.user_nodes WHERE id = ${node_id}::uuid LIMIT 1
  `) as { id: string; client_id: string; parent_id: string | null; level_number: number | null; role_id: string; display_name: string }[];
  if (!target) return jsonError(404, 'not_found');
  if (target.client_id !== clientId) return jsonError(400, 'cross_client');

  const [newRole] = (await sql`
    SELECT id, client_id, key FROM public.client_roles WHERE id = ${new_role_id}::uuid LIMIT 1
  `) as { id: string; client_id: string; key: string }[];
  if (!newRole) return jsonError(404, 'not_found');
  if (newRole.client_id !== clientId) return jsonError(400, 'cross_client');

  // Self-block.
  if (session.kind === 'bucket_user' && session.user_node_id === target.id) {
    return jsonError(403, 'self_role_change_forbidden');
  }

  // No-op.
  if (target.role_id === new_role_id) {
    return jsonOk({ ok: true, no_change: true, node: target });
  }

  // Unassigned guard.
  if (target.level_number === null) {
    return jsonError(400, 'unassigned_node');
  }

  // Cardinality projection.
  const card = await validateCardinality(sql, clientId, target.parent_id, new_role_id, target.role_id);
  if (!card.ok) return jsonError(400, card.code, { max: card.max });

  // Old role key for audit detail.
  const [oldRole] = (await sql`
    SELECT key FROM public.client_roles WHERE id = ${target.role_id}::uuid LIMIT 1
  `) as { key: string }[];

  // Commit.
  const [updated] = (await sql`
    UPDATE public.user_nodes SET role_id = ${new_role_id}::uuid, updated_at = now()
    WHERE id = ${target.id}::uuid
    RETURNING id, client_id, parent_id, level_number, role_id, display_name
  `) as { id: string; client_id: string; parent_id: string | null; level_number: number; role_id: string; display_name: string }[];

  await logAudit(sql, {
    session,
    op: 'users.role_changed',
    clientId,
    targetType: 'user_node',
    targetId: target.id,
    detail: {
      from_role_key: oldRole?.key ?? null,
      to_role_key: newRole.key,
      target_id: target.id,
      level_number: target.level_number,
    },
  });

  return jsonOk({ ok: true, node: updated });
};
