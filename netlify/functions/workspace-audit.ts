import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import { withTenantContext } from '../../src/lib/tenancy.ts';
import { json, methodNotAllowed } from '../../src/lib/http.ts';

export const config = { path: '/api/workspaces/:wsid/audit' };

/**
 * GET /api/workspaces/:wsid/audit
 *
 * Workspace-scoped audit log viewer feed. Returns events newest-first.
 * Permissions:
 *   - `audit:read` (Primary + Manager) for the base feed.
 *   - Admin impersonation events are visible to all members; the
 *     `audit:read_admin_activity` capability is implicit when admin
 *     activity targets the workspace.
 *
 * Query params (all optional):
 *   action      — filter by action prefix (e.g. "product." catches
 *                 product.create, product.update, product.delete).
 *   actorId     — filter by the *real* actor user id (admin id if
 *                 impersonating, or the user id otherwise).
 *   resourceType — filter by audit_events.resource_type
 *                 (product, export_job, backup, …).
 *   since / until — ISO timestamps for date-range filtering.
 *   limit       — page size 1..200 (default 50).
 *   offset      — pagination offset (default 0).
 *
 * Response:
 *   { events: AuditEvent[], total: number }
 *
 * Each event includes actor + on-behalf-of email lookups so the UI
 * can render readable names without N+1 fetches.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[workspace-audit] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  if (req.method !== 'GET') return methodNotAllowed();

  const workspaceId = context.params?.wsid;
  if (!workspaceId) return json({ error: 'missing_workspace_id' }, 400);

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor } = resolved;

  if (!can(actor, 'audit:read', { type: 'audit_event', workspaceId })) {
    return json({ error: 'forbidden' }, 403);
  }

  const url = new URL(req.url);
  const q = url.searchParams;
  const action = q.get('action')?.trim() || null;
  const actorId = q.get('actorId')?.trim() || null;
  const resourceType = q.get('resourceType')?.trim() || null;
  const since = q.get('since')?.trim() || null;
  const until = q.get('until')?.trim() || null;
  const limit = clamp(parseInt(q.get('limit') ?? '50', 10), 1, 200);
  const offset = Math.max(parseInt(q.get('offset') ?? '0', 10), 0);

  const where: string[] = ['ae.workspace_id = $1'];
  const params: unknown[] = [workspaceId];
  let idx = 2;
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

  return withTenantContext(
    { userId: actor.realActorId, workspaceId },
    async (c) => {
      const [rows, total] = await Promise.all([
        c.query(
          `SELECT ae.id, ae.workspace_id, ae.actor_user_id, ae.on_behalf_of,
                  ae.impersonation_reason, ae.action, ae.resource_type, ae.resource_id,
                  ae.before_data, ae.after_data, ae.metadata, ae.occurred_at,
                  ua.email AS actor_email, uo.email AS on_behalf_of_email
           FROM audit_events ae
           LEFT JOIN users ua ON ua.id = ae.actor_user_id
           LEFT JOIN users uo ON uo.id = ae.on_behalf_of
           ${whereSql}
           ORDER BY ae.occurred_at DESC
           LIMIT $${idx} OFFSET $${idx + 1}`,
          [...params, limit, offset],
        ),
        c.query(
          `SELECT count(*)::int AS n FROM audit_events ae ${whereSql}`,
          params,
        ),
      ]);

      const events = rows.rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspace_id,
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
    },
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
