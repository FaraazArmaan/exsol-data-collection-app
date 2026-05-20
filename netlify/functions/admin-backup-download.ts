import type { Context } from '@netlify/functions';
import { getBackup } from '../../src/lib/backup-engine.ts';
import * as blobStorage from '../../src/lib/blob-storage.ts';
import { json, methodNotAllowed, requireAdmin } from '../../src/lib/http.ts';
import type { ActorContext } from '../../src/lib/types.ts';

export const config = { path: '/api/admin/backups/:backupId/download' };

/**
 * GET /api/admin/backups/:backupId/download
 *
 * Streams a completed system backup ZIP. Admin-only. The backup row
 * is fetched via `getBackup` with an admin ActorContext, so the lookup
 * succeeds without a workspace scope.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[admin-backup-download] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  if (req.method !== 'GET') return methodNotAllowed();
  const backupId = context.params?.backupId;
  if (!backupId) return json({ error: 'missing_param' }, 400);

  const u = await requireAdmin(req);
  if (u instanceof Response) return u;

  const actor: ActorContext = {
    realActorId: u.id,
    realRole: 'admin',
    onBehalfOfId: null,
    workspaceRole: null,
    workspaceId: null,
    isImpersonating: false,
    impersonationReason: null,
  };

  const backup = await getBackup(actor, backupId);
  if (!backup) return json({ error: 'not_found' }, 404);
  if (backup.kind !== 'system') return json({ error: 'wrong_kind' }, 400);
  if (backup.status !== 'done' || !backup.blobKey) {
    return json({ error: 'not_ready', status: backup.status }, 409);
  }

  const blob = await blobStorage.getSystemBackup(backup.blobKey);
  if (!blob) return json({ error: 'blob_missing' }, 410);

  return new Response(blob.stream, {
    status: 200,
    headers: {
      'content-type': blob.contentType,
      'content-disposition': `attachment; filename="${sanitizeForFilename(blob.filename)}"`,
      'cache-control': 'private, max-age=0, no-store',
    },
  });
}

function sanitizeForFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/["\\/\x00-\x1f]/g, '_');
}
