import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import { getBackup } from '../../src/lib/backup-engine.ts';
import * as blobStorage from '../../src/lib/blob-storage.ts';
import { json, methodNotAllowed } from '../../src/lib/http.ts';

export const config = { path: '/api/workspaces/:wsid/backups/:backupId/download' };

/**
 * GET /api/workspaces/:wsid/backups/:backupId/download
 *
 * Streams a completed workspace backup ZIP back as a file attachment.
 * Permission gating: `backup:download` (Primary only).
 *
 * Status checks before stream:
 *   - Backup row exists and is in this workspace (RLS-enforced)
 *   - status === 'done'
 *   - blob_key resolves in the workspace-backups Blob store
 *
 * 404 / 409 / 410 returned as appropriate so the UI can render a clean
 * message instead of a generic 500.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[workspace-backup-download] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  if (req.method !== 'GET') return methodNotAllowed();

  const workspaceId = context.params?.wsid;
  const backupId = context.params?.backupId;
  if (!workspaceId || !backupId) return json({ error: 'missing_param' }, 400);

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor } = resolved;

  if (!can(actor, 'backup:download', { type: 'backup', workspaceId })) {
    return json({ error: 'forbidden' }, 403);
  }

  const backup = await getBackup(actor, backupId);
  if (!backup) return json({ error: 'not_found' }, 404);
  if (backup.status !== 'done' || !backup.blobKey) {
    return json({ error: 'not_ready', status: backup.status, backupError: backup.error }, 409);
  }
  if (backup.kind !== 'workspace' || backup.workspaceId !== workspaceId) {
    return json({ error: 'not_found' }, 404);
  }

  const blob = await blobStorage.getWorkspaceBackup(backup.blobKey);
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
