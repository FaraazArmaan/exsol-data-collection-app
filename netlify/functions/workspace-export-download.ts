import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import { getJob } from '../../src/lib/export-engine.ts';
import * as blobStorage from '../../src/lib/blob-storage.ts';
import { json, methodNotAllowed } from '../../src/lib/http.ts';

export const config = { path: '/api/workspaces/:wsid/exports/:jobId/download' };

/**
 * GET /api/workspaces/:wsid/exports/:jobId/download
 *
 * Streams a completed export's bytes back as a file attachment.
 *
 * Authenticated (`export:read`) and tenant-scoped: the `getJob` lookup
 * runs through RLS, so a user can only download from their own
 * workspace. If the job is in any state other than 'done' (queued,
 * running, failed), returns 409 with the status so the UI can render
 * an informative message instead of "404 not found."
 *
 * Sets `Content-Disposition: attachment; filename="..."` so the
 * browser saves rather than tries to render.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[workspace-export-download] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  if (req.method !== 'GET') return methodNotAllowed();

  const workspaceId = context.params?.wsid;
  const jobId = context.params?.jobId;
  if (!workspaceId || !jobId) return json({ error: 'missing_param' }, 400);

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor } = resolved;

  if (!can(actor, 'export:read', { type: 'export_job', workspaceId })) {
    return json({ error: 'forbidden' }, 403);
  }

  const job = await getJob(actor, jobId);
  if (!job) return json({ error: 'not_found' }, 404);
  if (job.status !== 'done' || !job.blobKey) {
    return json({ error: 'not_ready', status: job.status, jobError: job.error }, 409);
  }

  const blob = await blobStorage.getExport(job.blobKey);
  if (!blob) return json({ error: 'blob_missing', detail: 'Export row points at a key that is no longer in storage' }, 410);

  return new Response(blob.stream, {
    status: 200,
    headers: {
      'content-type': blob.contentType,
      'content-disposition': `attachment; filename="${sanitizeForFilename(blob.filename)}"`,
      'cache-control': 'private, max-age=0, no-store',
    },
  });
}

/**
 * Strip characters that break the Content-Disposition header, keeping
 * the filename usable across browsers without quoting acrobatics.
 */
function sanitizeForFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/["\\/\x00-\x1f]/g, '_');
}
