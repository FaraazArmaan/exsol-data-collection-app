// GET /api/audit-log — admin-only paginated query over public.audit_log.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';

const Query = z.object({
  actor_admin: z.string().uuid().optional(),
  actor_user_node: z.string().uuid().optional(),
  impersonated_by_admin: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  op: z.string().min(1).max(200).optional(),
  target_type: z.string().min(1).max(50).optional(),
  target_id: z.string().min(1).max(200).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  page_size: z.coerce.number().int().min(1).optional().default(50),
});

interface Row {
  id: number;
  occurred_at: string;
  actor_admin: string | null;
  actor_user_node: string | null;
  impersonated_by_admin: string | null;
  op: string;
  client_id: string | null;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  admin_email: string | null;
  impersonator_admin_email: string | null;
  user_node_display_name: string | null;
  client_name: string | null;
  target_label: string | null;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams);
  const parsed = Query.safeParse(raw);
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const f = parsed.data;

  const pageSize = Math.min(f.page_size, 200);
  const offset = (f.page - 1) * pageSize;

  const sql = db();

  // Conditional filters inlined as `(${param}::type IS NULL OR col = ${param}::type)`.
  // Neon driver parameterises each placeholder; a NULL bind disables that filter.
  const rows = (await sql`
    SELECT
      a.id, a.occurred_at, a.actor_admin, a.actor_user_node, a.impersonated_by_admin, a.op,
      a.client_id, a.target_type, a.target_id, a.detail,
      adm.email AS admin_email,
      imp.email AS impersonator_admin_email,
      un.display_name AS user_node_display_name,
      c.name AS client_name,
      COALESCE(
        tn.display_name,
        tr.label,
        tl.label,
        ta.email,
        CASE WHEN a.target_type = 'client' THEN c.name ELSE NULL END,
        NULL
      ) AS target_label
    FROM public.audit_log a
    LEFT JOIN public.admins adm ON adm.id = a.actor_admin
    LEFT JOIN public.admins imp ON imp.id = a.impersonated_by_admin
    LEFT JOIN public.user_nodes un ON un.id = a.actor_user_node
    LEFT JOIN public.clients c ON c.id = a.client_id
    LEFT JOIN public.user_nodes tn   ON a.target_type = 'user_node' AND tn.id::text = a.target_id
    LEFT JOIN public.client_roles tr ON a.target_type = 'role'      AND tr.id::text = a.target_id
    LEFT JOIN public.client_levels tl ON a.target_type = 'level'    AND tl.id::text = a.target_id
    LEFT JOIN public.admins ta       ON a.target_type = 'admin'     AND ta.id::text = a.target_id
    WHERE
      (${f.actor_admin ?? null}::uuid IS NULL OR a.actor_admin = ${f.actor_admin ?? null}::uuid)
      AND (${f.actor_user_node ?? null}::uuid IS NULL OR a.actor_user_node = ${f.actor_user_node ?? null}::uuid)
      AND (${f.impersonated_by_admin ?? null}::uuid IS NULL OR a.impersonated_by_admin = ${f.impersonated_by_admin ?? null}::uuid)
      AND (${f.client_id ?? null}::uuid IS NULL OR a.client_id = ${f.client_id ?? null}::uuid)
      AND (${f.op ?? null}::text IS NULL OR a.op = ${f.op ?? null}::text)
      AND (${f.target_type ?? null}::text IS NULL OR a.target_type = ${f.target_type ?? null}::text)
      AND (${f.target_id ?? null}::text IS NULL OR a.target_id = ${f.target_id ?? null}::text)
      AND (${f.since ?? null}::timestamptz IS NULL OR a.occurred_at >= ${f.since ?? null}::timestamptz)
      AND (${f.until ?? null}::timestamptz IS NULL OR a.occurred_at < ${f.until ?? null}::timestamptz)
    ORDER BY a.occurred_at DESC, a.id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `) as Row[];

  const countRows = (await sql`
    SELECT count(*)::bigint AS c FROM public.audit_log a
    WHERE
      (${f.actor_admin ?? null}::uuid IS NULL OR a.actor_admin = ${f.actor_admin ?? null}::uuid)
      AND (${f.actor_user_node ?? null}::uuid IS NULL OR a.actor_user_node = ${f.actor_user_node ?? null}::uuid)
      AND (${f.impersonated_by_admin ?? null}::uuid IS NULL OR a.impersonated_by_admin = ${f.impersonated_by_admin ?? null}::uuid)
      AND (${f.client_id ?? null}::uuid IS NULL OR a.client_id = ${f.client_id ?? null}::uuid)
      AND (${f.op ?? null}::text IS NULL OR a.op = ${f.op ?? null}::text)
      AND (${f.target_type ?? null}::text IS NULL OR a.target_type = ${f.target_type ?? null}::text)
      AND (${f.target_id ?? null}::text IS NULL OR a.target_id = ${f.target_id ?? null}::text)
      AND (${f.since ?? null}::timestamptz IS NULL OR a.occurred_at >= ${f.since ?? null}::timestamptz)
      AND (${f.until ?? null}::timestamptz IS NULL OR a.occurred_at < ${f.until ?? null}::timestamptz)
  `) as { c: string }[];
  const total = Number(countRows[0]!.c);

  const entries = rows.map((r) => {
    const actor = r.actor_admin
      ? { kind: 'admin' as const, id: r.actor_admin, label: r.admin_email ?? '(deleted admin)' }
      : r.actor_user_node
        ? { kind: 'bucket_user' as const, id: r.actor_user_node, label: r.user_node_display_name ?? '(deleted user)' }
        : { kind: 'unknown' as const, id: null, label: '(no actor)' };
    return {
      id: r.id,
      occurred_at: r.occurred_at,
      actor,
      impersonated_by_admin: r.impersonated_by_admin
        ? { kind: 'admin' as const, id: r.impersonated_by_admin, label: r.impersonator_admin_email ?? '(deleted admin)' }
        : null,
      op: r.op,
      client_id: r.client_id,
      client_name: r.client_name,
      target_type: r.target_type,
      target_id: r.target_id,
      target_label: r.target_label,
      detail: r.detail,
    };
  });

  return jsonOk({ entries, total, page: f.page, page_size: pageSize });
};
