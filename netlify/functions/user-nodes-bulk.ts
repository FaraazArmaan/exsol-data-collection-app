// netlify/functions/user-nodes-bulk.ts
//
// POST /api/user-nodes-bulk — admin or owner.
// Pre-validates every row in one in-memory pass; on success pre-generates
// UUIDs for all new user_nodes (and credentials) and commits via one
// sql.transaction([...]). Mirrors the onboard-client.ts pattern: any error
// rolls the whole batch back atomically. 500-row cap.
//
// Reuses _platform.users.create. Spec: docs/superpowers/specs/2026-06-04-bulk-operations-design.md §4.2.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import {
  authenticateForPermission, resolveClientIdOrRespond, type AnySession,
} from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { hashPassword } from './_shared/argon';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';

const RowSchema = z.object({
  display_name: z.string().min(1).max(200),
  role_key: z.string().min(1).max(50),
  level_number: z.number().int().positive().nullable().optional(),
  parent_email: z.string().email().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  create_login: z.boolean().optional(),
  temp_password: z.string().min(8).max(200).optional(),
});
const Body = z.object({ rows: z.array(RowSchema) });

interface RowError { row_index: number; errors: string[] }

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  const auth = await authenticateForPermission(req, '_platform.users.create');
  if (auth instanceof Response) return auth;
  const session: AnySession = auth;

  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const clientId = scope.clientId;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const { rows } = parsed.data;
  // Precedence (matches UI tooltip): too_many_rows > bulk_validation_failed > empty_payload.
  if (rows.length > 500) return jsonError(400, 'too_many_rows');
  if (rows.length === 0) return jsonError(400, 'empty_payload');

  const sql = db();

  // Load client structure + existing nodes once.
  const roles = (await sql`
    SELECT id, key FROM public.client_roles WHERE client_id = ${clientId}::uuid
  `) as { id: string; key: string }[];
  const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));

  const configuredLevelNumbersRows = (await sql`
    SELECT level_number FROM public.client_levels WHERE client_id = ${clientId}::uuid
  `) as { level_number: number }[];
  const configuredLevelNumbers = new Set(configuredLevelNumbersRows.map((l) => l.level_number));

  const rules = (await sql`
    SELECT parent_role_id, child_role_id, max_children
    FROM public.client_cardinality_rules WHERE client_id = ${clientId}::uuid
  `) as { parent_role_id: string | null; child_role_id: string; max_children: number }[];
  function capFor(parentRoleId: string | null, childRoleId: string): number | null {
    for (const r of rules) {
      const parentMatch = (r.parent_role_id === null && parentRoleId === null)
        || (r.parent_role_id !== null && r.parent_role_id === parentRoleId);
      if (parentMatch && r.child_role_id === childRoleId) return r.max_children;
    }
    return null;
  }

  const existingNodes = (await sql`
    SELECT id, email, parent_id, level_number, role_id
    FROM public.user_nodes WHERE client_id = ${clientId}::uuid
  `) as { id: string; email: string | null; parent_id: string | null; level_number: number | null; role_id: string }[];
  const existingByEmail = new Map<string, { id: string; role_id: string; level_number: number | null }>();
  for (const n of existingNodes) {
    if (n.email) existingByEmail.set(n.email.toLowerCase(), { id: n.id, role_id: n.role_id, level_number: n.level_number });
  }

  // Pre-generate ids so cross-row parent resolution works.
  const newIds: string[] = rows.map(() => crypto.randomUUID());

  // Index incoming rows by email so a child row can resolve its parent_email
  // to an in-batch sibling row.
  const incomingByEmail = new Map<string, { idx: number; role_id: string; level_number: number | null }>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row.email) continue;
    const rid = roleIdByKey.get(row.role_key);
    if (!rid) continue;
    incomingByEmail.set(row.email.toLowerCase(), {
      idx: i, role_id: rid, level_number: row.level_number ?? null,
    });
  }

  // Track per-parent counts for cardinality (existing + incoming).
  // Keys: `${parentId|'root'}:${childRoleId}` → count.
  const counts = new Map<string, number>();
  for (const n of existingNodes) {
    const key = `${n.parent_id ?? 'root'}:${n.role_id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Row → resolved parent_id (null if root, undefined if unresolvable).
  const resolvedParentId: (string | null | undefined)[] = [];
  const errors: RowError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowErrors: string[] = [];

    const roleId = roleIdByKey.get(row.role_key);
    if (!roleId) rowErrors.push(`Role "${row.role_key}" not found`);

    // Verify the level exists for the workspace; role-level coupling has been
    // removed (any role can exist at any level). See
    // docs/superpowers/specs/2026-06-08-levels-roles-decoupling-design.md.
    if (row.level_number !== null && row.level_number !== undefined) {
      if (!configuredLevelNumbers.has(row.level_number)) {
        rowErrors.push(`Level ${row.level_number} not configured`);
      }
    }

    let parentId: string | null | undefined = null;
    let parentRoleId: string | null = null;
    if (row.parent_email) {
      const key = row.parent_email.toLowerCase();
      const existing = existingByEmail.get(key);
      if (existing) { parentId = existing.id; parentRoleId = existing.role_id; }
      else {
        const incoming = incomingByEmail.get(key);
        if (incoming) {
          if (incoming.idx === i) { rowErrors.push('parent_email refers to this row'); parentId = undefined; }
          else { parentId = newIds[incoming.idx]!; parentRoleId = incoming.role_id; }
        } else {
          rowErrors.push(`parent_email "${row.parent_email}" not found`);
          parentId = undefined;
        }
      }
    }

    if (row.create_login && (!row.temp_password || row.temp_password.length < 8)) {
      rowErrors.push('create_login=true requires temp_password (≥8 chars)');
    }
    if (row.create_login && !row.email) {
      rowErrors.push('create_login=true requires email');
    }

    // Cardinality (only when no other errors on this row, otherwise miscounts).
    // capFor takes the parent's *role id* (or null for root), not the parent node id.
    if (rowErrors.length === 0 && roleId) {
      const key = `${parentId ?? 'root'}:${roleId}`;
      const cap = capFor(parentRoleId, roleId);
      const current = counts.get(key) ?? 0;
      if (cap !== null && current + 1 > cap) {
        rowErrors.push(`max ${cap} ${row.role_key} per parent — would be ${current + 1}`);
      } else {
        counts.set(key, current + 1);
      }
    }

    if (rowErrors.length > 0) errors.push({ row_index: i, errors: rowErrors });
    resolvedParentId.push(parentId);
  }

  if (errors.length > 0) return jsonError(400, 'bulk_validation_failed', { errors });

  // Hash all temp passwords outside the txn (argon2 is slow).
  const credHashes: (string | null)[] = await Promise.all(rows.map(async (r) =>
    r.create_login && r.temp_password ? await hashPassword(r.temp_password) : null,
  ));

  const adminId = session.kind === 'admin' ? session.admin.id : null;
  const creatorUserNodeId = session.kind === 'bucket_user' ? session.user_node_id : null;

  // Build the txn. Insert in level order (roots first) so PK/FK never trips.
  const order = [...rows.keys()].sort((a, b) => (rows[a]!.level_number ?? 0) - (rows[b]!.level_number ?? 0));
  const queries: unknown[] = [];
  for (const i of order) {
    const r = rows[i]!;
    const id = newIds[i]!;
    const roleId = roleIdByKey.get(r.role_key)!;
    queries.push(sql`
      INSERT INTO public.user_nodes (
        id, client_id, parent_id, level_number, role_id,
        display_name, email, phone, notes, fields,
        created_by_admin, created_by_user_node
      ) VALUES (
        ${id}::uuid, ${clientId}::uuid, ${resolvedParentId[i] ?? null}::uuid,
        ${r.level_number ?? null}, ${roleId}::uuid,
        ${r.display_name}, ${r.email ?? null}, ${r.phone ?? null},
        ${r.notes ?? null}, '{}'::jsonb,
        ${adminId}::uuid, ${creatorUserNodeId}::uuid
      )
    `);
    if (r.create_login && r.email && credHashes[i]) {
      queries.push(sql`
        INSERT INTO public.user_node_credentials (
          client_id, user_node_id, email, password_hash, must_change_password,
          temp_password_plain, temp_password_views_left, created_by_admin, created_by_user_node
        ) VALUES (
          ${clientId}::uuid, ${id}::uuid, ${r.email},
          ${credHashes[i]}, true, ${r.temp_password!}, 3,
          ${adminId}::uuid, ${creatorUserNodeId}::uuid
        )
      `);
    }
  }

  try {
    await sql.transaction(queries as never);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') return jsonError(409, 'email_already_in_use_in_this_client');
    throw e;
  }

  const loginCount = rows.filter((r) => r.create_login && r.email).length;
  const roleKeysUnique = Array.from(new Set(rows.map((r) => r.role_key)));

  await logAudit(sql, {
    session,
    op: 'users.bulk_invited',
    clientId,
    targetType: 'client',
    targetId: clientId,
    detail: {
      count: rows.length,
      role_keys: roleKeysUnique,
      login_count: loginCount,
      has_temp_passwords: loginCount > 0,
    },
  });

  // Return the inserted nodes (re-fetch to get sort_order/created_at consistent shape).
  const nodes = (await sql`
    SELECT id, client_id, parent_id, level_number, role_id, display_name, email,
           phone, notes, fields, sort_order, created_at, updated_at, created_by_admin
    FROM public.user_nodes
    WHERE id = ANY(${newIds}::uuid[])
    ORDER BY level_number NULLS LAST, sort_order, created_at
  `) as unknown[];
  return jsonOk({ nodes, login_count: loginCount }, { status: 201 });
};
