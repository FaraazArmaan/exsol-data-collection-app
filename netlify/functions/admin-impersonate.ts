import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { AdminCapabilityError, requireAdminCapability, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { mintBucketUserSession, impersonationBuCookieHeader } from './_shared/session';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';

const Body = z.object({
  clientId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  userNodeId: z.string().uuid().optional(),
});

// POST /api/admin-impersonate  body { clientId, reason }
//
// Admin-only "view as client". Mints a workspace (bucket-user) session for the
// selected user node. If no userNodeId is supplied, uses the client's L1 Owner
// node as the Admin / Full access surrogate. Every entry is audit-logged and
// the downstream bucket-user session carries the real admin for audit attribution.
//
// The FE sets a separate, non-HttpOnly imp_ctx cookie (client name) to drive the
// "viewing as admin" banner, and clears it + bu_session (via u-logout) on exit.
export const config = { path: '/api/admin-impersonate', method: 'POST' };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  let actor;
  try { actor = await requireAdminCapability(req, 'admin.impersonate'); } catch (e) {
    if (e instanceof AdminCapabilityError) return jsonError(403, 'admin_role_forbidden', { capability: e.capability });
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const b = parsed.data;

  const sql = db();
  const clientRows = (await sql`
    SELECT id, slug, name FROM public.clients WHERE id = ${b.clientId}::uuid LIMIT 1
  `) as { id: string; slug: string; name: string }[];
  const client = clientRows[0];
  if (!client) return jsonError(404, 'client_not_found');

  const targetRows = b.userNodeId
    ? (await sql`
      SELECT n.id AS node_id, n.display_name, n.level_number, COALESCE(cr.email, n.email) AS email
      FROM public.user_nodes n
      LEFT JOIN public.user_node_credentials cr ON cr.user_node_id = n.id
      WHERE n.client_id = ${client.id}::uuid AND n.id = ${b.userNodeId}::uuid
      LIMIT 1
    `)
    : (await sql`
    SELECT n.id AS node_id, n.display_name, n.level_number, COALESCE(cr.email, n.email) AS email
    FROM public.user_nodes n
    LEFT JOIN public.user_node_credentials cr ON cr.user_node_id = n.id
    WHERE n.client_id = ${client.id}::uuid AND n.level_number = 1
    ORDER BY (cr.email IS NULL) ASC, n.created_at ASC
    LIMIT 1
  `);
  const target = (targetRows as { node_id: string; display_name: string; level_number: number | null; email: string | null }[])[0];
  if (!target) return b.userNodeId
    ? jsonError(404, 'user_node_not_found')
    : jsonError(409, 'no_owner_node', 'client has no L1 Owner node to impersonate');

  const email = target.email ?? `admin-impersonation@${client.slug}.exsol`;
  const startedAt = new Date().toISOString();
  const token = await mintBucketUserSession(
    { sub: target.node_id, email, client_id: client.id },
    {
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
      impersonatedByAdmin: actor.admin.id,
      impersonationStartedAt: startedAt,
      impersonationReason: b.reason,
    },
  );

  await logAudit(sql, {
    session: { kind: 'admin', admin: { id: actor.admin.id, email: actor.claims.email } },
    op: 'admin.impersonate',
    clientId: client.id,
    targetType: 'client',
    targetId: client.id,
    detail: {
      as_user_node: target.node_id,
      as_level_number: target.level_number,
      mode: b.userNodeId ? 'user' : 'admin_full_access',
      client_slug: client.slug,
      reason: b.reason,
      started_at: startedAt,
    },
  });

  return jsonOk(
    {
      slug: client.slug,
      name: client.name,
      impersonation_started_at: startedAt,
      as_user_node: target.node_id,
      as_display_name: target.display_name,
      mode: b.userNodeId ? 'user' : 'admin_full_access',
    },
    { headers: { 'Set-Cookie': impersonationBuCookieHeader(token) } },
  );
};
