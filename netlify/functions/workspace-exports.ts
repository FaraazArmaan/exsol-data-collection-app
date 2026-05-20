import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import {
  run,
  listJobs,
  type ExportProfile,
  type ExportFilter,
} from '../../src/lib/export-engine.ts';
import { json, methodNotAllowed, readJson } from '../../src/lib/http.ts';
import type { Marketplace, ProductStatus } from '../../src/lib/types.ts';

export const config = { path: '/api/workspaces/:wsid/exports' };

/**
 * /api/workspaces/:wsid/exports
 *
 *   POST — start a new export.
 *     Body: { profile, filter? }
 *     200:  { job: { id, profile, status: 'done', filename }, downloadUrl }
 *     400:  invalid_profile / no_rows
 *     413:  too_large (with rowCount + ceiling in body)
 *     Permission: export:create.
 *
 *   GET  — list recent jobs (newest first, up to 20).
 *     200: { jobs: JobRow[] }
 *     Permission: export:read.
 *
 * The response carries the file bytes inline as base64 in the POST 200
 * payload's `inline` field, so a tiny export can be downloaded without
 * a second round-trip. Larger exports (above ~3 MB after base64
 * encoding) skip the inline field and the client uses the downloadUrl
 * exclusively. The bytes always live in Blobs under the job's blob_key.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[workspace-exports] uncaught', err);
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
    if (!can(actor, 'export:read', { type: 'export_job', workspaceId })) {
      return json({ error: 'forbidden' }, 403);
    }
    const jobs = await listJobs(actor);
    return json({ jobs });
  }

  if (req.method === 'POST') {
    if (!can(actor, 'export:create', { type: 'export_job', workspaceId })) {
      return json({ error: 'forbidden' }, 403);
    }
    const body = await readJson<{ profile?: unknown; filter?: unknown }>(req);
    if (!body) return json({ error: 'invalid_json' }, 400);
    const profile = body.profile as ExportProfile;
    const filter: ExportFilter = (body.filter as ExportFilter | undefined) ?? {};
    if (!profile) return json({ error: 'missing_profile' }, 400);

    // Normalise filter fields and discard unknowns to keep the engine
    // input schema tight.
    const safeFilter: ExportFilter = {
      search: typeof filter.search === 'string' ? filter.search : undefined,
      status: (filter.status as ProductStatus | null | undefined) ?? undefined,
      categoryId: typeof filter.categoryId === 'string' ? filter.categoryId : undefined,
      marketplaceEnabled: filter.marketplaceEnabled as Marketplace | undefined,
    };

    const result = await run({ actor, profile, filter: safeFilter });
    if (!result.ok) {
      const status = result.error === 'too_large' ? 413 : 400;
      return json(result, status);
    }

    // Inline payload only if reasonably small (~3 MB base64 = ~2.25 MB raw).
    const inlineCutoff = 2 * 1024 * 1024;
    const inline = result.bytes.byteLength <= inlineCutoff
      ? Buffer.from(result.bytes).toString('base64')
      : null;

    return json({
      job: {
        id: result.jobId,
        profile,
        status: 'done',
        filename: result.filename,
        contentType: result.contentType,
        sizeBytes: result.bytes.byteLength,
      },
      downloadUrl: `/api/workspaces/${workspaceId}/exports/${result.jobId}/download`,
      inline,
    });
  }

  return methodNotAllowed();
}
