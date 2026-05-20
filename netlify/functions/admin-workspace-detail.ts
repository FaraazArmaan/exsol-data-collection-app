import type { Context } from '@netlify/functions';
import { withAdminContext } from '../../src/lib/tenancy.ts';
import { isUnlocked } from '../../src/lib/workspace-unlock-manager.ts';
import { json, methodNotAllowed, requireAdmin } from '../../src/lib/http.ts';

export const config = { path: '/api/admin/workspaces/:id' };

/**
 * GET /api/admin/workspaces/:id
 *
 * Admin's workspace detail. Always returns the workspace name. Full
 * detail (team list, product count, primary user) is gated by an
 * active unlock claim — locked responses include `unlocked: false`
 * so the admin UI can prompt for the access key.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[admin-workspace-detail] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  if (req.method !== 'GET') return methodNotAllowed();
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const workspaceId = context.params?.id;
  if (!workspaceId) return json({ error: 'missing_workspace_id' }, 400);

  const unlocked = await isUnlocked(admin.id, workspaceId);

  const detail = await withAdminContext({ userId: admin.id }, async (c) => {
    const wsRes = await c.query(
      `SELECT w.id, w.name, w.currency, w.timezone, w.created_at,
              w.disabled_at, w.key_rotated_at,
              u.id AS primary_user_id, u.email AS primary_email, u.name AS primary_name
       FROM workspaces w
       JOIN users u ON u.id = w.primary_user_id
       WHERE w.id = $1 AND w.deleted_at IS NULL`,
      [workspaceId],
    );
    if ((wsRes.rowCount ?? 0) === 0) return null;
    const workspace = wsRes.rows[0];

    if (!unlocked) {
      return { workspace: { id: workspace.id, name: workspace.name }, unlocked: false };
    }

    const membersRes = await c.query(
      `SELECT u.id, u.email, u.name, u.photo_url, m.role,
              m.invited_at, m.accepted_at,
              CASE WHEN u.id = $2 THEN true ELSE false END AS is_primary
       FROM workspace_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1
       ORDER BY m.invited_at`,
      [workspaceId, workspace.primary_user_id],
    );

    const productCount = await c.query(
      `SELECT count(*)::int AS n FROM products WHERE workspace_id = $1`,
      [workspaceId],
    );

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        currency: workspace.currency,
        timezone: workspace.timezone,
        createdAt: workspace.created_at,
        disabledAt: workspace.disabled_at,
        keyRotatedAt: workspace.key_rotated_at,
        primary: {
          id: workspace.primary_user_id,
          email: workspace.primary_email,
          name: workspace.primary_name,
        },
      },
      members: membersRes.rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        photoUrl: row.photo_url,
        role: row.role,
        invitedAt: row.invited_at,
        acceptedAt: row.accepted_at,
        isPrimary: row.is_primary,
      })),
      productCount: productCount.rows[0].n,
      unlocked: true,
    };
  });

  if (!detail) return json({ error: 'not_found' }, 404);
  return json(detail);
}
