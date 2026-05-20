import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import { runWorkspace, listWorkspaceBackups } from '../../src/lib/backup-engine.ts';
import { json, methodNotAllowed } from '../../src/lib/http.ts';

export const config = { path: '/api/workspaces/:wsid/backups' };

/**
 * /api/workspaces/:wsid/backups
 *
 *   POST — kick off a workspace backup (sync). Returns the new backup
 *          row's metadata. The actual ZIP is streamed via the download
 *          endpoint.
 *          Permission: backup:run (Primary only).
 *   GET  — list recent backups for this workspace.
 *          Permission: backup:read (Primary only).
 *
 * Backups can be large (10s of MB once images are attached); we never
 * inline them in the response.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[workspace-backups] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  const workspaceId = context.params?.wsid;
  if (!workspaceId) return json({ error: 'missing_workspace_id' }, 400);

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor } = resolved;

  if (req.method === 'GET') {
    if (!can(actor, 'backup:read', { type: 'backup', workspaceId })) {
      return json({ error: 'forbidden' }, 403);
    }
    const backups = await listWorkspaceBackups(actor);
    return json({ backups });
  }

  if (req.method === 'POST') {
    if (!can(actor, 'backup:run', { type: 'backup', workspaceId })) {
      return json({ error: 'forbidden' }, 403);
    }
    const result = await runWorkspace(actor);
    if (!result.ok) return json(result, 400);
    return json({
      backup: {
        id: result.backupId,
        filename: result.filename,
        sizeBytes: result.sizeBytes,
        contentType: result.contentType,
      },
      downloadUrl: `/api/workspaces/${workspaceId}/backups/${result.backupId}/download`,
    });
  }

  return methodNotAllowed();
}
