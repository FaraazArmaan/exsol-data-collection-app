import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import { stockViews } from '../../src/lib/product-service.ts';
import { json, methodNotAllowed } from '../../src/lib/http.ts';

export const config = { path: '/api/workspaces/:wsid/stock/views' };

/**
 * GET /api/workspaces/:wsid/stock/views
 *
 * Returns three product lists for the dashboard tiles:
 *   - lowStock:   products at or below their low-stock threshold.
 *   - deadStock:  active products with no outbound movement in N days.
 *   - fastMovers: top 10 by recent outbound movement velocity (30 days).
 *
 * Thresholds are per-product if set, otherwise workspace defaults.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[workspace-stock-views] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
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
}
