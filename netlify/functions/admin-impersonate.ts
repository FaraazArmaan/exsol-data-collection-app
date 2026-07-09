import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { mintBucketUserSession, buCookieHeader } from './_shared/session';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';

// POST /api/admin-impersonate  body { clientId }
//
// Admin-only "view as client". Mints a workspace (bucket-user) session for the
// client's L1 Owner node and sets the bu_session cookie — so the admin can open
// /c/:slug/<module> with full Owner access (read-write; writes attribute to the
// Owner node, per the chosen model). Every entry is audit-logged.
//
// The FE sets a separate, non-HttpOnly imp_ctx cookie (client name) to drive the
// "viewing as admin" banner, and clears it + bu_session (via u-logout) on exit.
export const config = { path: '/api/admin-impersonate', method: 'POST' };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const b = (await req.json().catch(() => ({}))) as { clientId?: string };
  if (!b.clientId) return jsonError(400, 'validation_failed', 'clientId required');
  try { assertUuid(b.clientId, 'clientId'); } catch { return jsonError(400, 'validation_failed', 'clientId must be uuid'); }

  const sql = db();
  const clientRows = (await sql`
    SELECT id, slug, name FROM public.clients WHERE id = ${b.clientId}::uuid LIMIT 1
  `) as { id: string; slug: string; name: string }[];
  const client = clientRows[0];
  if (!client) return jsonError(404, 'client_not_found');

  // L1 Owner node. Prefer one that has a login credential (its email becomes the
  // session's display claim); fall back to any Owner node with a synthetic email.
  const ownerRows = (await sql`
    SELECT n.id AS node_id, cr.email AS email
    FROM public.user_nodes n
    LEFT JOIN public.user_node_credentials cr ON cr.user_node_id = n.id
    WHERE n.client_id = ${client.id}::uuid AND n.level_number = 1
    ORDER BY (cr.email IS NULL) ASC, n.created_at ASC
    LIMIT 1
  `) as { node_id: string; email: string | null }[];
  const owner = ownerRows[0];
  if (!owner) return jsonError(409, 'no_owner_node', 'client has no L1 Owner node to impersonate');

  const email = owner.email ?? `admin-impersonation@${client.slug}.exsol`;
  const token = await mintBucketUserSession(
    { sub: owner.node_id, email, client_id: client.id },
    { userAgent: req.headers.get('user-agent') },
  );

  await logAudit(sql, {
    session: { kind: 'admin', admin: { id: actor.admin.id, email: actor.claims.email } },
    op: 'admin.impersonate',
    clientId: client.id,
    targetType: 'client',
    targetId: client.id,
    detail: { as_user_node: owner.node_id, client_slug: client.slug },
  });

  return jsonOk(
    { slug: client.slug, name: client.name },
    { headers: { 'Set-Cookie': buCookieHeader(token) } },
  );
};
