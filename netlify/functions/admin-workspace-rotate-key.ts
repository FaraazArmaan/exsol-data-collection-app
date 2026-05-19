import type { Context } from '@netlify/functions';
import { rotateKey } from '../../src/lib/workspace-unlock-manager.ts';
import { json, methodNotAllowed, requireAdmin } from '../../src/lib/http.ts';

export const config = { path: '/api/admin/workspaces/:id/rotate-key' };

export default async (req: Request, context: Context): Promise<Response> => {
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
};
