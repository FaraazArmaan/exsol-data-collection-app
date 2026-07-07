// /api/pos/bundles — staff bundle management (list + create).
//
// A bundle is a real products row (so it flows through the existing storefront
// menu/catalog unchanged) plus product_bundle_items linking it to components.
// Creating one inserts the bundle product (type physical, no own stock — its
// availability derives from components) then the item rows. Gated on
// pos.sale.refund (frozen-key reuse, manager tier) with L1 bypass.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requirePos } from './_pos-authz';
import { loadBundles } from './_shared/bundles';
import { z } from 'zod';

export const config = { path: '/api/pos/bundles' };

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  priceCents: z.number().int().min(0),
  storefrontVisible: z.boolean().default(true),
  components: z
    .array(z.object({ productId: z.string().uuid(), qty: z.number().int().positive().max(99) }))
    .min(1)
    .max(20),
});

export default async function handler(req: Request): Promise<Response> {
  const a = await requirePos(req, ['pos.sale.refund']);
  if (!a.ok) return a.res;
  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT p.id, p.name, p.price_cents, p.storefront_visible
      FROM public.products p
      WHERE p.client_id = ${a.ctx.clientId}::uuid AND p.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM public.product_bundle_items bi WHERE bi.bundle_product_id = p.id)
      ORDER BY p.created_at DESC
    `) as Array<{ id: string; name: string; price_cents: number; storefront_visible: boolean }>;
    const info = await loadBundles(sql, a.ctx.clientId, rows.map((r) => r.id));
    return jsonOk({
      bundles: rows.map((r) => ({
        id: r.id,
        name: r.name,
        priceCents: Number(r.price_cents),
        storefrontVisible: r.storefront_visible,
        inStock: info.get(r.id)?.inStock ?? true,
        components: info.get(r.id)?.components ?? [],
      })),
    });
  }

  if (req.method === 'POST') {
    let body: z.infer<typeof CreateBody>;
    try {
      body = CreateBody.parse(await req.json());
    } catch (e: any) {
      return jsonError(400, 'invalid_body', { issues: e?.issues });
    }

    const ids = [...new Set(body.components.map((c) => c.productId))];
    if (ids.length !== body.components.length) return jsonError(400, 'duplicate_component');

    // Components must be this client's live products, and not themselves bundles
    // (no nesting — keeps stock derivation single-level).
    const valid = (await sql`
      SELECT p.id,
             EXISTS (SELECT 1 FROM public.product_bundle_items bi WHERE bi.bundle_product_id = p.id) AS is_bundle
      FROM public.products p
      WHERE p.id = ANY(${ids}::uuid[]) AND p.client_id = ${a.ctx.clientId}::uuid
        AND p.deleted_at IS NULL AND p.status = 'active'
    `) as Array<{ id: string; is_bundle: boolean }>;
    if (valid.length !== ids.length) return jsonError(400, 'invalid_component');
    if (valid.some((v) => v.is_bundle)) return jsonError(400, 'nested_bundle');

    const inserted = (await sql`
      INSERT INTO public.products (client_id, type, name, price_cents, status, storefront_visible, pos_visible)
      VALUES (${a.ctx.clientId}::uuid, 'physical', ${body.name}, ${body.priceCents}, 'active', ${body.storefrontVisible}, true)
      RETURNING id
    `) as Array<{ id: string }>;
    const bundleId = inserted[0]!.id;

    let position = 0;
    for (const c of body.components) {
      await sql`
        INSERT INTO public.product_bundle_items (bundle_product_id, component_product_id, qty, position)
        VALUES (${bundleId}::uuid, ${c.productId}::uuid, ${c.qty}, ${position++})
      `;
    }
    return jsonOk({ id: bundleId }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
