import type { Context } from '@netlify/functions';
import { runSystem, listSystemBackups } from '../../src/lib/backup-engine.ts';
import { json, methodNotAllowed, requireAdmin } from '../../src/lib/http.ts';
import type { ActorContext } from '../../src/lib/types.ts';

export const config = { path: '/api/admin/backups' };

/**
 * /api/admin/backups
 *
 *   POST — trigger a full-system backup (cross-workspace DB dump).
 *          Admin-only.
 *   GET  — list recent system backups, newest first.
 *
 * Companion endpoint `admin-backup-download` streams a completed backup.
 */
export default async (req: Request, _context: Context): Promise<Response> => {
  try {
    return await handle(req);
  } catch (err) {
    console.error('[admin-backups] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request): Promise<Response> {
  const u = await requireAdmin(req);
  if (u instanceof Response) return u;

  // Synthesize a minimal admin ActorContext — there is no workspace
  // scope for system backups.
  const actor: ActorContext = {
    realActorId: u.id,
    realRole: 'admin',
    onBehalfOfId: null,
    workspaceRole: null,
    workspaceId: null,
    isImpersonating: false,
    impersonationReason: null,
  };

  if (req.method === 'GET') {
    const backups = await listSystemBackups(actor);
    return json({ backups });
  }

  if (req.method === 'POST') {
    const result = await runSystem(actor);
    if (!result.ok) return json(result, 400);
    return json({
      backup: {
        id: result.backupId,
        filename: result.filename,
        sizeBytes: result.sizeBytes,
        contentType: result.contentType,
      },
      downloadUrl: `/api/admin/backups/${result.backupId}/download`,
    });
  }

  return methodNotAllowed();
}
