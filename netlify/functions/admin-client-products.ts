//
// GET    ?client=<id>  → { enabled_keys: string[], available: ProductManifest[] }
// PUT    ?client=<id>  body { keys: string[] } → replaces the enabled set
//
// Admin-only. PUT validates each key against the productRegistry — unknown
// keys reject the whole request (no partial writes). The replacement is
// transactional: delete-all + insert-many in one statement burst.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { logAudit } from './_shared/audit';
import { allProducts, getProduct } from '../../src/modules/registry/products';

const PutBody = z.object({ keys: z.array(z.string().min(1).max(80)).max(64) });

export default async (req: Request, _ctx: Context) => {
  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }

  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT product_key FROM public.client_enabled_products
      WHERE client_id = ${clientId}::uuid
      ORDER BY product_key
    `) as { product_key: string }[];
    return jsonOk({
      enabled_keys: rows.map((r) => r.product_key),
      available: allProducts().map((p) => ({ key: p.key, label: p.label })),
    });
  }

  if (req.method === 'PUT') {
    const parsed = PutBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    for (const key of parsed.data.keys) {
      if (!getProduct(key)) return jsonError(400, 'unknown_product_key', { key });
    }
    await sql.transaction([
      sql`DELETE FROM public.client_enabled_products WHERE client_id = ${clientId}::uuid`,
      ...parsed.data.keys.map((key) => sql`
        INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
        VALUES (${clientId}::uuid, ${key}, ${actor.admin.id}::uuid)
      `),
    ]);
    await logAudit(sql, {
      session: { kind: 'admin', admin: { id: actor.admin.id, email: '' } },
      op: 'products.replaced',
      clientId,
      targetType: 'client',
      targetId: clientId,
      detail: { keys: parsed.data.keys },
    });
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
