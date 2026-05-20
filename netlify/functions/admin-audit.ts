import type { Context } from '@netlify/functions';
import { withAdminContext } from '../../src/lib/tenancy.ts';
import { json, methodNotAllowed, requireAdmin } from '../../src/lib/http.ts';

export const config = { path: '/api/admin/audit' };

/**
 * GET /api/admin/audit
 *
 * System-wide audit log feed. Visible to admin only; reads through
 * `withAdminContext` so RLS doesn't hide events from other workspaces.
 *
 * Same filter grammar as workspace-audit, plus an optional
 * `workspaceId` filter for when an admin wants to focus on one Client.
 *
 * For the row-level join to users, falls back to NULL email when the
 * user has been deleted (workspaces.audit retains the event row even
 * if the user row went away via a DELETE cascade — for tribunal
 * purposes that's the right default).
 */
export default async (req: Request, _context: Context): Promise<Response> => {
  try {
    return await handle(req);
  } catch (err) {
    console.error('[admin-audit] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'GET') return methodNotAllowed();
  const u = await requireAdmin(req);
  if (u instanceof Response) return u;

  const url = new URL(req.url);
  const q = url.searchParams;
  const action = q.get('action')?.trim() || null;
  const actorId = q.get('actorId')?.trim() || null;
  const resourceType = q.get('resourceType')?.trim() || null;
  const workspaceId = q.get('workspaceId')?.trim() || null;
  const since = q.get('since')?.trim() || null;
  const until = q.get('until')?.trim() || null;
  const limit = clamp(parseInt(q.get('limit') ?? '50', 10), 1, 200);
  const offset = Math.max(parseInt(q.get('offset') ?? '0', 10), 0);

  const where: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (workspaceId) {
    where.push(`ae.workspace_id = $${idx}`);
    params.push(workspaceId);
    idx++;
  }
  if (action) {
    where.push(`ae.action LIKE $${idx}`);
    params.push(`${action}%`);
    idx++;
  }
  if (actorId) {
    where.push(`ae.actor_user_id = $${idx}`);
    params.push(actorId);
    idx++;
  }
  if (resourceType) {
    where.push(`ae.resource_type = $${idx}`);
    params.push(resourceType);
    idx++;
  }
  if (since) {
    where.push(`ae.occurred_at >= $${idx}`);
    params.push(since);
    idx++;
  }
  if (until) {
    where.push(`ae.occurred_at <= $${idx}`);
    params.push(until);
    idx++;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return withAdminContext({ userId: u.id }, async (c) => {
    const [rows, total] = await Promise.all([
      c.query(
        `SELECT ae.id, ae.workspace_id, ae.actor_user_id, ae.on_behalf_of,
                ae.impersonation_reason, ae.action, ae.resource_type, ae.resource_id,
                ae.before_data, ae.after_data, ae.metadata, ae.occurred_at,
                w.name AS workspace_name,
                ua.email AS actor_email, uo.email AS on_behalf_of_email
         FROM audit_events ae
         LEFT JOIN workspaces w ON w.id = ae.workspace_id
         LEFT JOIN users ua ON ua.id = ae.actor_user_id
         LEFT JOIN users uo ON uo.id = ae.on_behalf_of
         ${whereSql}
         ORDER BY ae.occurred_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      ),
      c.query(`SELECT count(*)::int AS n FROM audit_events ae ${whereSql}`, params),
    ]);

    const events = rows.rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_name,
      actorUserId: r.actor_user_id,
      actorEmail: r.actor_email,
      onBehalfOfId: r.on_behalf_of,
      onBehalfOfEmail: r.on_behalf_of_email,
      impersonationReason: r.impersonation_reason,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      before: r.before_data,
      after: r.after_data,
      metadata: r.metadata,
      occurredAt: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : r.occurred_at,
    }));

    return json({ events, total: total.rows[0].n });
  });
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
