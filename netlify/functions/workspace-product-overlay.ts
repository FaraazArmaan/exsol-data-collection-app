import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import { setMarketplaceOverlay } from '../../src/lib/product-service.ts';
import { json, methodNotAllowed, readJson } from '../../src/lib/http.ts';

export const config = {
  path: '/api/workspaces/:wsid/products/:pid/marketplaces/:mp',
};

type Body = {
  fields?: unknown;
  enabled?: unknown;
};

/**
 * PUT /api/workspaces/:wsid/products/:pid/marketplaces/:mp
 *
 * Replace (or create) the marketplace overlay for a given product.
 * The `fields` body is freeform JSON in v1; per-marketplace structured
 * field forms come in v1.1. The `enabled` flag controls whether this
 * overlay is included in marketplace-targeted exports.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[workspace-product-overlay] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  if (req.method !== 'PUT') return methodNotAllowed();

  const workspaceId = context.params?.wsid;
  const productId = context.params?.pid;
  const marketplace = context.params?.mp;
  if (!workspaceId || !productId || !marketplace) {
    return json({ error: 'missing_param' }, 400);
  }

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor } = resolved;

  if (!can(actor, 'product:update', { type: 'product', workspaceId })) {
    return json({ error: 'forbidden' }, 403);
  }

  const body = await readJson<Body>(req);
  if (!body) return json({ error: 'invalid_json' }, 400);
  if (typeof body.enabled !== 'boolean') {
    return json({ error: 'invalid_enabled' }, 400);
  }
  if (typeof body.fields !== 'object' || body.fields === null) {
    return json({ error: 'invalid_fields' }, 400);
  }

  const result = await setMarketplaceOverlay(actor, productId, marketplace, {
    fields: body.fields as Record<string, unknown>,
    enabled: body.enabled,
  });
  if ('error' in result) {
    const status =
      result.error === 'not_found'
        ? 404
        : result.error === 'invalid_marketplace'
          ? 400
          : 400;
    return json(result, status);
  }
  return json({ overlay: result });
}
