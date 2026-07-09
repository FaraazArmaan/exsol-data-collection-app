import type { Context } from '@netlify/functions';
import { z } from 'zod';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { db } from './_shared/db';
import {
  authenticateForPermission, resolveClientIdOrRespond,
  type AnySession,
} from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { hashPassword } from './_shared/argon';
import { getCardinalityCap } from './_shared/user-tree';
import { subtreeOf } from './_shared/subtree';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';

const CreateBody = z.object({
  role_id: z.string().uuid(),
  parent_id: z.string().uuid().nullable().optional(),
  level_number: z.number().int().positive().nullable().optional(),
  display_name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  fields: z.record(z.unknown()).optional(),
  create_login: z.boolean().optional(),
  temp_password: z.string().min(8).max(200).optional(),
});

export default async (req: Request, _ctx: Context) => {
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  let session: AnySession;

  if (req.method === 'GET') {
    const auth = await authenticateForPermission(req, '_platform.users.view');
    if (auth instanceof Response) return auth;
    session = auth;
  } else if (req.method === 'POST') {
    const auth = await authenticateForPermission(req, '_platform.users.create');
    if (auth instanceof Response) return auth;
    session = auth;
  } else {
    return jsonError(405, 'method_not_allowed');
  }

  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const clientId = scope.clientId;
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }

  const sql = db();

  if (req.method === 'GET') {
    // L2+ bucket-user callers granted _platform.users.view see only their own
    // subtree (themselves + descendants). Admin and L1 Owner see everything.
    let allowedIds: string[] | null = null;
    if (session.kind === 'bucket_user' && session.level_number > 1) {
      allowedIds = await subtreeOf(sql, session.user_node_id);
    }
    const nodes = (allowedIds === null
      ? await sql`
        SELECT n.id, n.client_id, n.parent_id, n.level_number, n.role_id,
               n.display_name, n.email, n.phone, n.notes, n.fields, n.sort_order,
               n.created_at, n.updated_at, n.created_by_admin,
               (c.user_node_id IS NOT NULL) AS has_login,
               (c.password_reset_requested_at IS NOT NULL) AS has_reset_request
        FROM public.user_nodes n
        LEFT JOIN public.user_node_credentials c ON c.user_node_id = n.id
        WHERE n.client_id = ${clientId}::uuid
        ORDER BY n.level_number NULLS LAST, n.sort_order, n.created_at
      `
      : await sql`
        SELECT n.id, n.client_id, n.parent_id, n.level_number, n.role_id,
               n.display_name, n.email, n.phone, n.notes, n.fields, n.sort_order,
               n.created_at, n.updated_at, n.created_by_admin,
               (c.user_node_id IS NOT NULL) AS has_login,
               (c.password_reset_requested_at IS NOT NULL) AS has_reset_request
        FROM public.user_nodes n
        LEFT JOIN public.user_node_credentials c ON c.user_node_id = n.id
        WHERE n.client_id = ${clientId}::uuid
          AND n.id = ANY(${allowedIds}::uuid[])
        ORDER BY n.level_number NULLS LAST, n.sort_order, n.created_at
      `) as unknown[];
    return jsonOk({ nodes });
  }

  if (req.method === 'POST') {
    const adminId = session.kind === 'bucket_user' ? null : session.admin.id;
    const creatorUserNodeId = session.kind === 'bucket_user' ? session.user_node_id : null;
    return await handleCreate(req, sql, clientId, adminId, creatorUserNodeId, session);
  }

  return jsonError(405, 'method_not_allowed');
};

async function handleCreate(
  req: Request,
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  adminId: string | null,
  creatorUserNodeId: string | null,
  session: AnySession,
): Promise<Response> {
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const data = parsed.data;

  // Look up the role to confirm same client.
  const roles = (await sql`
    SELECT id, client_id FROM public.client_roles WHERE id = ${data.role_id}::uuid LIMIT 1
  `) as { id: string; client_id: string }[];
  if (roles.length === 0) return jsonError(404, 'role_not_found');
  if (roles[0]!.client_id !== clientId) return jsonError(400, 'role_wrong_client');

  // Determine effective level + parent.
  // - both null → unassigned
  // - parent_id null + level_number=1 → top-level
  // - parent_id set → level_number must be parent.level + 1
  const wantsUnassigned = (data.parent_id === null || data.parent_id === undefined)
    && (data.level_number === null || data.level_number === undefined);

  let effectiveLevel: number | null = null;
  let effectiveParent: string | null = null;
  let parentRoleId: string | null = null;

  if (!wantsUnassigned) {
    if (data.parent_id) {
      const p = (await sql`
        SELECT id, client_id, level_number, role_id FROM public.user_nodes
        WHERE id = ${data.parent_id}::uuid LIMIT 1
      `) as { id: string; client_id: string; level_number: number | null; role_id: string }[];
      if (p.length === 0) return jsonError(404, 'parent_not_found');
      if (p[0]!.client_id !== clientId) return jsonError(400, 'cross_client_parent');
      if (p[0]!.level_number === null) return jsonError(400, 'parent_level_mismatch');
      const desiredLevel = data.level_number ?? p[0]!.level_number + 1;
      if (desiredLevel !== p[0]!.level_number + 1) return jsonError(400, 'parent_level_mismatch');
      effectiveLevel = desiredLevel;
      effectiveParent = data.parent_id;
      parentRoleId = p[0]!.role_id;
    } else {
      // parent_id null, level_number must be 1
      if (data.level_number !== 1) return jsonError(400, 'top_level_requires_level_1');
      effectiveLevel = 1;
    }

    // Cardinality enforcement.
    // For top-level: advisory lock on (client_id, role_id) hash + count.
    // For child: SELECT FOR UPDATE on parent row + count.
    const cap = await getCardinalityCap(sql, clientId, parentRoleId, data.role_id);
    if (cap !== null) {
      // Cardinality + insert in a transaction.
      try {
        const insertResult = await sql.transaction([
          ...(effectiveParent === null
            ? [sql`SELECT pg_advisory_xact_lock(hashtext(${clientId} || ':' || ${data.role_id}))`]
            : [sql`SELECT 1 FROM public.user_nodes WHERE id = ${effectiveParent}::uuid FOR UPDATE`]),
          effectiveParent === null
            ? sql`SELECT count(*)::int AS c FROM public.user_nodes
                  WHERE client_id = ${clientId}::uuid AND parent_id IS NULL AND role_id = ${data.role_id}::uuid`
            : sql`SELECT count(*)::int AS c FROM public.user_nodes
                  WHERE parent_id = ${effectiveParent}::uuid AND role_id = ${data.role_id}::uuid`,
          sql`
            INSERT INTO public.user_nodes (
              client_id, parent_id, level_number, role_id,
              display_name, email, phone, notes, fields, created_by_admin, created_by_user_node
            )
            VALUES (
              ${clientId}::uuid,
              ${effectiveParent}::uuid,
              ${effectiveLevel},
              ${data.role_id}::uuid,
              ${data.display_name},
              ${data.email ?? null},
              ${data.phone ?? null},
              ${data.notes ?? null},
              ${JSON.stringify(data.fields ?? {})}::jsonb,
              ${adminId}::uuid,
              ${creatorUserNodeId}::uuid
            )
            RETURNING id, client_id, parent_id, level_number, role_id, display_name, email,
                      phone, notes, fields, sort_order, created_at, updated_at, created_by_admin
          `,
        ] as never);
        // insertResult is an array of result sets: [lock?, count, inserted]
        const arr = insertResult as unknown as unknown[][];
        const countRow = arr[arr.length - 2] as Array<{ c: number }>;
        const inserted = arr[arr.length - 1] as Array<Record<string, unknown>>;
        if (countRow[0]!.c >= cap) {
          // The insert succeeded inside the txn but exceeds cap — throw to roll back.
          throw new Error(`cardinality_exceeded:${cap}`);
        }
        const node = inserted[0]!;
        return await maybeCreateCredential(sql, clientId, node, data, adminId, creatorUserNodeId, session);
      } catch (e: unknown) {
        const msg = (e as Error)?.message ?? '';
        const code = (e as { code?: string })?.code;
        if (msg.startsWith('cardinality_exceeded')) {
          return jsonError(409, 'cardinality_exceeded', { max: cap });
        }
        if (msg.includes('parent_level_mismatch')) return jsonError(400, 'parent_level_mismatch');
        if (msg.includes('cross_client_parent')) return jsonError(400, 'cross_client_parent');
        if (code === '23505') return jsonError(409, 'email_already_in_use_in_this_client');
        throw e;
      }
    }
  }

  // No cardinality cap (or unassigned). Just insert.
  try {
    const rows = (await sql`
      INSERT INTO public.user_nodes (
        client_id, parent_id, level_number, role_id,
        display_name, email, phone, notes, fields, created_by_admin, created_by_user_node
      )
      VALUES (
        ${clientId}::uuid,
        ${effectiveParent}::uuid,
        ${effectiveLevel},
        ${data.role_id}::uuid,
        ${data.display_name},
        ${data.email ?? null},
        ${data.phone ?? null},
        ${data.notes ?? null},
        ${JSON.stringify(data.fields ?? {})}::jsonb,
        ${adminId}::uuid,
        ${creatorUserNodeId}::uuid
      )
      RETURNING id, client_id, parent_id, level_number, role_id, display_name, email,
                phone, notes, fields, sort_order, created_at, updated_at, created_by_admin
    `) as Record<string, unknown>[];
    return await maybeCreateCredential(sql, clientId, rows[0]!, data, adminId, creatorUserNodeId, session);
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? '';
    const code = (e as { code?: string })?.code;
    if (msg.includes('parent_level_mismatch')) return jsonError(400, 'parent_level_mismatch');
    if (msg.includes('cross_client_parent')) return jsonError(400, 'cross_client_parent');
    if (code === '23505') return jsonError(409, 'email_already_in_use_in_this_client');
    throw e;
  }
}

async function maybeCreateCredential(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  node: Record<string, unknown>,
  data: z.infer<typeof CreateBody>,
  adminId: string | null,
  creatorUserNodeId: string | null,
  session: AnySession,
): Promise<Response> {
  const nodeId = node.id as string;
  if (!data.create_login) {
    await logAudit(sql, {
      session,
      op: 'user_node.created',
      clientId,
      targetType: 'user_node',
      targetId: nodeId,
      detail: {
        display_name: data.display_name,
        role_id: data.role_id,
        level_number: data.level_number ?? null,
        has_login: false,
      },
    });
    return jsonOk({ node }, { status: 201 });
  }

  if (!data.temp_password || data.temp_password.length < 8) {
    // Roll back the user_node insert (best effort).
    await sql`DELETE FROM public.user_nodes WHERE id = ${node.id as string}::uuid`;
    return jsonError(400, 'validation_failed', 'temp_password (>=8) required with create_login');
  }
  if (!data.email) {
    await sql`DELETE FROM public.user_nodes WHERE id = ${node.id as string}::uuid`;
    return jsonError(400, 'validation_failed', 'email required with create_login');
  }
  const pwdHash = await hashPassword(data.temp_password);
  try {
    await sql`
      INSERT INTO public.user_node_credentials (
        client_id, user_node_id, email, password_hash, must_change_password,
        temp_password_plain, temp_password_views_left, password_changed_at,
        created_by_admin, created_by_user_node
      ) VALUES (
        ${clientId}::uuid, ${node.id as string}::uuid, ${data.email},
        ${pwdHash}, true, ${data.temp_password}, 3, now(), ${adminId}::uuid, ${creatorUserNodeId}::uuid
      )
    `;
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    // Roll back node insert on credential conflict.
    await sql`DELETE FROM public.user_nodes WHERE id = ${node.id as string}::uuid`;
    if (code === '23505') return jsonError(409, 'email_already_has_login_in_this_client');
    throw e;
  }
  await logAudit(sql, {
    session,
    op: 'user_node.created',
    clientId,
    targetType: 'user_node',
    targetId: nodeId,
    detail: {
      display_name: data.display_name,
      role_id: data.role_id,
      level_number: data.level_number ?? null,
      has_login: true,
    },
  });
  return jsonOk({ node, login_created: true }, { status: 201 });
}
