import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import { createProduct, listProducts } from '../../src/lib/product-service.ts';
import { json, methodNotAllowed, readJson } from '../../src/lib/http.ts';
import type { Marketplace, ProductStatus } from '../../src/lib/types.ts';

export const config = { path: '/api/workspaces/:wsid/products' };

export default async (req: Request, context: Context): Promise<Response> => {
  const workspaceId = context.params?.wsid;
  if (!workspaceId) return json({ error: 'missing_workspace_id' }, 400);

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor } = resolved;

  if (req.method === 'GET') {
    if (!can(actor, 'product:read', { type: 'product', workspaceId })) {
      return json({ error: 'forbidden' }, 403);
    }
    const url = new URL(req.url);
    const q = url.searchParams;
    const result = await listProducts(actor, {
      search: q.get('search') ?? undefined,
      status: (q.get('status') as ProductStatus | null) ?? undefined,
      categoryId: q.get('category') ?? undefined,
      marketplaceEnabled: (q.get('marketplace') as Marketplace | null) ?? undefined,
      limit: q.get('limit') ? parseInt(q.get('limit')!, 10) : undefined,
      offset: q.get('offset') ? parseInt(q.get('offset')!, 10) : undefined,
    });
    return json(result);
  }

  if (req.method === 'POST') {
    if (!can(actor, 'product:create', { type: 'product', workspaceId })) {
      return json({ error: 'forbidden' }, 403);
    }
    const body = await readJson<Record<string, unknown>>(req);
    if (!body) return json({ error: 'invalid_json' }, 400);
    const result = await createProduct(actor, body as any);
    if ('error' in result) {
      const status = result.error === 'duplicate_sku' ? 409 : 400;
      return json(result, status);
    }
    return json({ product: result });
  }

  return methodNotAllowed();
};
