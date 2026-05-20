import type { Context } from '@netlify/functions';
import { rotateKey } from '../../src/lib/workspace-unlock-manager.ts';
import { json, methodNotAllowed, requireAdmin } from '../../src/lib/http.ts';

export const config = { path: '/api/admin/workspaces/:id/rotate-key' };

/**
 * POST /api/admin/workspaces/:id/rotate-key
 *
 * Generates a fresh 12-character access key for the workspace and
 * invalidates all existing unlock claims for it. Returns the plaintext
 * key in the response (shown once to the admin, then shared with the
 * Primary out-of-band).
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[admin-workspace-rotate-key] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed();
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const workspaceId = context.params?.id;
  if (!workspaceId) return json({ error: 'missing_workspace_id' }, 400);

  const { plaintext } = await rotateKey(workspaceId, admin.id);
  return json({
    accessKey: plaintext,
    note: 'New access key generated. Existing unlocks are now invalid.',
  });
}
