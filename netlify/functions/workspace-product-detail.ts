import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import {
  deleteProduct,
  getProduct,
  updateProduct,
} from '../../src/lib/product-service.ts';
import { json, methodNotAllowed, readJson } from '../../src/lib/http.ts';

export const config = { path: '/api/workspaces/:wsid/products/:pid' };

/**
 * /api/workspaces/:wsid/products/:pid
 *
 *   GET    — single product detail + all marketplace overlays.
 *   PATCH  — partial update; computes a before/after audit diff.
 *   DELETE — remove product (and cascade to overlays + movements).
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[workspace-product-detail] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  const workspaceId = context.params?.wsid;
  const productId = context.params?.pid;
  if (!workspaceId || !productId) return json({ error: 'missing_param' }, 400);

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor } = resolved;

  if (req.method === 'GET') {
    if (!can(actor, 'product:read', { type: 'product', workspaceId })) {
      return json({ error: 'forbidden' }, 403);
    }
    const detail = await getProduct(actor, productId);
    if (!detail) return json({ error: 'not_found' }, 404);
    return json(detail);
  }

  if (req.method === 'PATCH') {
    if (!can(actor, 'product:update', { type: 'product', workspaceId })) {
      return json({ error: 'forbidden' }, 403);
    }
    const body = await readJson<Record<string, unknown>>(req);
    if (!body) return json({ error: 'invalid_json' }, 400);
    const result = await updateProduct(actor, productId, body as any);
    if ('error' in result) {
      const status =
        result.error === 'not_found'
          ? 404
          : result.error === 'duplicate_sku'
            ? 409
            : 400;
      return json(result, status);
    }
    return json({ product: result });
  }

  if (req.method === 'DELETE') {
    if (!can(actor, 'product:delete', { type: 'product', workspaceId })) {
      return json({ error: 'forbidden' }, 403);
    }
    const result = await deleteProduct(actor, productId);
    if ('error' in result) {
      return json({ error: result.error }, result.error === 'not_found' ? 404 : 400);
    }
    return json({ ok: true });
  }

  return methodNotAllowed();
}
