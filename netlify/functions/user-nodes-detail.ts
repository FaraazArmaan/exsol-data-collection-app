import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import {
  authenticateForPermission, authorizeClientScope, authorizeSubtreeScope,
} from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const PatchBody = z.object({
  display_name: z.string().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  fields: z.record(z.unknown()).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'at_least_one_field_required' });

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(id, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const sql = db();

  if (req.method === 'GET') {
    const auth = await authenticateForPermission(req, '_platform.users.view');
    if (auth instanceof Response) return auth;
    const session = auth;

    const rows = (await sql`
      SELECT id, client_id, parent_id, level_number, role_id, display_name, email,
             phone, notes, fields, sort_order, created_at, updated_at, created_by_admin
      FROM public.user_nodes WHERE id = ${id}::uuid LIMIT 1
    `) as Array<{ client_id: string }>;
    if (rows.length === 0) return jsonError(404, 'not_found');

    const scope = authorizeClientScope(session, rows[0]!.client_id);
    if ('error' in scope) return jsonError(403, scope.error);
    const subtree = await authorizeSubtreeScope(sql, session, id);
    if ('error' in subtree) return jsonError(403, subtree.error);

    const c = (await sql`SELECT count(*)::int AS c FROM public.user_nodes WHERE parent_id = ${id}::uuid`) as { c: number }[];
    return jsonOk({ node: rows[0], children_count: c[0]!.c });
  }

  if (req.method === 'PATCH') {
    const auth = await authenticateForPermission(req, '_platform.users.edit');
    if (auth instanceof Response) return auth;
    const session = auth;

    // Row-based authz: fetch first, then check client scope before mutating.
    const existing = (await sql`
      SELECT client_id FROM public.user_nodes WHERE id = ${id}::uuid LIMIT 1
    `) as { client_id: string }[];
    if (existing.length === 0) return jsonError(404, 'not_found');
    const scope = authorizeClientScope(session, existing[0]!.client_id);
    if ('error' in scope) return jsonError(403, scope.error);
    const subtree = await authorizeSubtreeScope(sql, session, id);
    if ('error' in subtree) return jsonError(403, subtree.error);

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    const d = parsed.data;
    const fieldsJson = d.fields !== undefined ? JSON.stringify(d.fields) : null;

    let rows: Array<{ id: string; client_id: string; email: string | null }>;
    try {
      rows = (await sql`
        UPDATE public.user_nodes
        SET display_name = COALESCE(${d.display_name ?? null}::text, display_name),
            email        = CASE WHEN ${d.email !== undefined}::boolean THEN ${d.email ?? null}::citext ELSE email END,
            phone        = CASE WHEN ${d.phone !== undefined}::boolean THEN ${d.phone ?? null}::text  ELSE phone END,
            notes        = CASE WHEN ${d.notes !== undefined}::boolean THEN ${d.notes ?? null}::text  ELSE notes END,
            fields       = COALESCE(${fieldsJson}::jsonb, fields)
        WHERE id = ${id}::uuid
        RETURNING id, client_id, parent_id, level_number, role_id, display_name, email,
                  phone, notes, fields, sort_order, created_at, updated_at, created_by_admin
      `) as Array<{ id: string; client_id: string; email: string | null }>;
    } catch (e: unknown) {
      // user_nodes_email_per_client_idx — unique per client (case-insensitive).
      const code = (e as { code?: string })?.code;
      if (code === '23505') return jsonError(409, 'email_taken_in_this_client');
      throw e;
    }
    if (rows.length === 0) return jsonError(404, 'not_found');
    const node = rows[0]!;

    // Propagate the email change to the credential row so login keeps
    // working. If the credential doesn't exist for this node, the UPDATE
    // is a no-op. If the new email collides with another credential's
    // email in the same client, the unique constraint will throw 23505
    // and we map it to a friendly error.
    if (d.email !== undefined && d.email !== null) {
      try {
        await sql`
          UPDATE public.user_node_credentials
             SET email = ${d.email}::citext
           WHERE user_node_id = ${node.id}::uuid
        `;
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === '23505') {
          // Edge case: the node update succeeded but the credential email
          // collides. Re-fetch and return so the caller sees the now-
          // inconsistent state and can decide. Rare in practice (would
          // require two credentials with the same target email in one client).
          return jsonError(409, 'credential_email_collision', {
            note: 'Node email updated but the credential email could not be propagated due to a collision. Use Manage login to reset the credential.',
          });
        }
        throw e;
      }
    }

    return jsonOk({ node });
  }

  if (req.method === 'DELETE') {
    const auth = await authenticateForPermission(req, '_platform.users.delete');
    if (auth instanceof Response) return auth;
    const session = auth;

    const existing = (await sql`
      SELECT client_id FROM public.user_nodes WHERE id = ${id}::uuid LIMIT 1
    `) as { client_id: string }[];
    if (existing.length === 0) return jsonError(404, 'not_found');
    const scope = authorizeClientScope(session, existing[0]!.client_id);
    if ('error' in scope) return jsonError(403, scope.error);
    const subtree = await authorizeSubtreeScope(sql, session, id);
    if ('error' in subtree) return jsonError(403, subtree.error);

    const cascade = url.searchParams.get('cascade') === 'descendants';

    if (!cascade) {
      const kids = (await sql`SELECT 1 FROM public.user_nodes WHERE parent_id = ${id}::uuid LIMIT 1`) as unknown[];
      if (kids.length > 0) return jsonError(409, 'has_children');
      const out = (await sql`DELETE FROM public.user_nodes WHERE id = ${id}::uuid RETURNING id`) as unknown[];
      if (out.length === 0) return jsonError(404, 'not_found');
      return jsonOk({ ok: true });
    }

    // Cascade: collect all descendants via recursive CTE, then delete them + the root.
    const out = (await sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM public.user_nodes WHERE id = ${id}::uuid
        UNION ALL
        SELECT n.id FROM public.user_nodes n JOIN subtree s ON n.parent_id = s.id
      )
      DELETE FROM public.user_nodes WHERE id IN (SELECT id FROM subtree)
      RETURNING id
    `) as unknown[];
    if (out.length === 0) return jsonError(404, 'not_found');
    return jsonOk({ ok: true, deleted_count: out.length });
  }

  return jsonError(405, 'method_not_allowed');
};
