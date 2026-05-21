import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import { bulkCreateProducts } from '../../src/lib/product-service.ts';
import type { ProductCore } from '../../src/lib/product-service.ts';
import { json, methodNotAllowed, readJson } from '../../src/lib/http.ts';

// NOTE: this path is intentionally NOT `/products/bulk` — that collides with
// `/products/:pid` in workspace-product-detail.ts (Netlify's :pid matches "bulk").
export const config = { path: '/api/workspaces/:wsid/products-bulk' };

const MAX_ROWS = 1000;

/**
 * /api/workspaces/:wsid/products/bulk
 *
 *   POST — create up to 1000 products in one call.
 *
 * Per-row error collection: bad rows reported in `errors[]` with their index;
 * valid rows still get inserted. Reuses createProduct's validation + audit.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[workspace-products-bulk] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed();

  const workspaceId = context.params?.wsid;
  if (!workspaceId) return json({ error: 'missing_workspace_id' }, 400);

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor } = resolved;

  if (!can(actor, 'product:create', { type: 'product', workspaceId })) {
    return json({ error: 'forbidden' }, 403);
  }

  const body = await readJson<{ products?: unknown }>(req);
  if (!body) return json({ error: 'invalid_json' }, 400);
  if (!Array.isArray(body.products)) {
    return json({ error: 'invalid_input', detail: 'products must be an array' }, 400);
  }
  if (body.products.length > MAX_ROWS) {
    return json(
      { error: 'too_many_rows', detail: `max ${MAX_ROWS} rows per call, got ${body.products.length}` },
      413,
    );
  }

  const result = await bulkCreateProducts(actor, body.products as ProductCore[]);
  return json(result);
}
