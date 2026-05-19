import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import { stockViews } from '../../src/lib/product-service.ts';
import { json, methodNotAllowed } from '../../src/lib/http.ts';

export const config = { path: '/api/workspaces/:wsid/stock/views' };

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== 'GET') return methodNotAllowed();
  const workspaceId = context.params?.wsid;
  if (!workspaceId) return json({ error: 'missing_workspace_id' }, 400);

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor } = resolved;

  if (!can(actor, 'stock:read', { type: 'product', workspaceId })) {
    return json({ error: 'forbidden' }, 403);
  }

  const views = await stockViews(actor);
  return json(views);
};
