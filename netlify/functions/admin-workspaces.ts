import { withAdminContext } from '../../src/lib/tenancy.ts';
import { generateAndHashKey } from '../../src/lib/workspace-unlock-manager.ts';
import { record as recordAudit } from '../../src/lib/audit-log-writer.ts';
import {
  json,
  methodNotAllowed,
  readJson,
  requireAdmin,
  safeStr,
} from '../../src/lib/http.ts';

export const config = { path: '/api/admin/workspaces' };

export default async (req: Request): Promise<Response> => {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  if (req.method === 'GET') return list(admin.id);
  if (req.method === 'POST') return create(req, admin.id);
  return methodNotAllowed();
};

async function list(adminId: string): Promise<Response> {
  const rows = await withAdminContext({ userId: adminId }, async (c) => {
    const r = await c.query(
      `SELECT
         w.id, w.name, w.currency, w.timezone, w.disabled_at, w.created_at,
         u.email AS primary_email, u.name AS primary_name,
         (SELECT count(*) FROM products p WHERE p.workspace_id = w.id) AS product_count,
         (SELECT count(*) FROM workspace_memberships m WHERE m.workspace_id = w.id) AS member_count,
         EXISTS (
           SELECT 1 FROM workspace_unlocks wu
           WHERE wu.admin_user_id = $1 AND wu.workspace_id = w.id AND wu.expires_at > now()
         ) AS unlocked
       FROM workspaces w
       JOIN users u ON u.id = w.primary_user_id
       WHERE w.deleted_at IS NULL
       ORDER BY w.created_at DESC`,
      [adminId],
    );
    return r.rows;
  });
  return json({ workspaces: rows });
}

type CreateBody = {
  workspaceName?: unknown;
  primaryEmail?: unknown;
  primaryName?: unknown;
};

async function create(req: Request, adminId: string): Promise<Response> {
  const body = await readJson<CreateBody>(req);
  if (!body) return json({ error: 'invalid_json' }, 400);

  const workspaceName = safeStr(body.workspaceName, 200);
  const primaryEmailRaw = safeStr(body.primaryEmail, 255);
  const primaryName = safeStr(body.primaryName, 200) ?? primaryEmailRaw;

  if (!workspaceName || !primaryEmailRaw) {
    return json({ error: 'missing_fields' }, 400);
  }
  const primaryEmail = primaryEmailRaw.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(primaryEmail)) {
    return json({ error: 'invalid_email' }, 400);
  }

  const { plaintext: accessKey, hash } = await generateAndHashKey();

  const result = await withAdminContext({ userId: adminId }, async (c) => {
    const existing = await c.query(`SELECT id, is_admin FROM users WHERE email = $1`, [primaryEmail]);
    let primaryUserId: string;
    if ((existing.rowCount ?? 0) === 0) {
      const ins = await c.query(
        `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
        [primaryEmail, primaryName],
      );
      primaryUserId = ins.rows[0].id;
    } else {
      primaryUserId = existing.rows[0].id;
      if (existing.rows[0].is_admin) {
        return { error: 'cannot_use_admin_email' as const };
      }
    }

    const wsIns = await c.query(
      `INSERT INTO workspaces (name, primary_user_id, admin_access_key_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [workspaceName, primaryUserId, hash],
    );
    const workspaceId = wsIns.rows[0].id as string;

    await c.query(
      `INSERT INTO workspace_memberships (user_id, workspace_id, role, accepted_at)
       VALUES ($1, $2, 'primary', now())
       ON CONFLICT (user_id, workspace_id) DO NOTHING`,
      [primaryUserId, workspaceId],
    );

    await recordAudit(
      {
        realActorId: adminId,
        workspaceId,
        action: 'admin.workspace_created',
        resourceType: 'workspace',
        resourceId: workspaceId,
        metadata: { workspace_name: workspaceName, primary_email: primaryEmail },
      },
      c,
    );

    return { ok: true as const, workspaceId, primaryUserId };
  });

  if ('error' in result) return json({ error: result.error }, 400);

  return json({
    workspaceId: result.workspaceId,
    primaryUserId: result.primaryUserId,
    accessKey,
    note: 'Show this access key to the Client now. It will not be displayed again.',
  });
}
