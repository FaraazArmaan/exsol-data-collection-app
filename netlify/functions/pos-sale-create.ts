// POST /api/pos/sales — create a sale in `pending_payment`, snapshot prices.
//
// Behavior:
//   - Validates body via SaleCreateBody (zod) → 400 on parse failure.
//   - Idempotency: `payment_ref` is reused as a double-duty column to store
//     the idempotency key with prefix `idem:` so it never collides with a
//     future Razorpay payment_id (those don't have our prefix). A repeated
//     POST within 24h from the same user_node with the same key returns the
//     existing sale (200), not a fresh row.
//   - Product hydration enforces same visibility filter as /menu — pos_visible
//     AND status='active' AND deleted_at IS NULL. Cross-bucket leak → 404
//     (treat as not-found), missing entirely → 400 (client sent garbage),
//     hidden/archived → 400.
//   - Unit price snapshot = COALESCE(sale_price_cents, price_cents), matching
//     the menu read so prices are consistent across surfaces.
//   - order_no allocation: SELECT MAX+1 inside same INSERT via CTE. The unique
//     constraint (bucket_id, order_no) catches concurrent racers; we retry up
//     to MAX_ATTEMPTS times on 23505 before giving up.
//
// v1 concerns (acceptable risk, documented):
//   - The neon http driver doesn't expose easy transactions, so sale-header
//     and sale_lines are inserted in separate statements. If the lines insert
//     fails after the header committed we end up with a sale row that has no
//     lines (orphan). Mitigation: lines insert is dead-simple; failure mode
//     is real DB outage, in which case the request is doomed anyway.
//   - The `payment_ref` double-duty is a v1 shortcut; a dedicated
//     `idempotency_key` column would be cleaner. Recorded for v2.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { logAudit } from './_shared/audit';
import { requirePos } from './_pos-authz';
import { SaleCreateBody } from './_pos-validators';
import type { NeonQueryFunction } from '@neondatabase/serverless';

// `method` disambiguates from sales-list.ts which declares the same path with GET.
// Netlify Functions v2 routes by (path, method); without explicit method here,
// requests would collide. See sibling-chat note + Netlify Functions docs.
export const config = { path: '/api/pos/sales', method: 'POST' };

const IDEM_PREFIX = 'idem:';
const MAX_ATTEMPTS = 5; // retry on unique-constraint race (order_no)

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.sale.create']);
  if (!a.ok) return a.res;

  let body: SaleCreateBody;
  try {
    body = SaleCreateBody.parse(await req.json());
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }

  const sql = db();
  const { clientId, userNodeId } = a.ctx;

  // Idempotency replay check — was this key used by this caller in the last 24h?
  const existing = (await sql`
    SELECT id FROM public.sales
    WHERE bucket_id = ${clientId}::uuid
      AND created_by_user_node = ${userNodeId}::uuid
      AND payment_ref = ${IDEM_PREFIX + body.idempotencyKey}
      AND created_at > now() - interval '24 hours'
    LIMIT 1
  `) as Array<{ id: string }>;
  if (existing[0]) {
    return jsonOk(await loadSaleResponse(sql, existing[0].id), { status: 200 });
  }

  // Hydrate products with full visibility check (mirrors /menu).
  const productIds = body.lines.map((l) => l.productId);
  const allProducts = (await sql`
    SELECT id, name,
           COALESCE(sale_price_cents, price_cents)::bigint AS unit_price_cents,
           client_id, pos_visible, deleted_at, status
    FROM public.products
    WHERE id = ANY(${productIds}::uuid[])
  `) as Array<{
    id: string;
    name: string;
    unit_price_cents: number | string;
    client_id: string;
    pos_visible: boolean;
    deleted_at: string | null;
    status: string;
  }>;

  if (allProducts.length !== productIds.length) {
    return jsonError(400, 'unknown_product');
  }
  if (allProducts.some((p) => p.client_id !== clientId)) {
    return jsonError(404, 'product_not_found');
  }
  if (allProducts.some((p) => p.deleted_at || p.status !== 'active' || !p.pos_visible)) {
    return jsonError(400, 'product_not_visible');
  }

  const byId = new Map(allProducts.map((p) => [p.id, p]));

  let subtotal = 0;
  const lineSpecs = body.lines.map((l, idx) => {
    const p = byId.get(l.productId)!;
    const unit = Number(p.unit_price_cents);
    const lineTotal = unit * l.qty;
    subtotal += lineTotal;
    return {
      productId: p.id,
      productName: p.name,
      unitPriceCents: unit,
      qty: l.qty,
      lineTotalCents: lineTotal,
      position: idx,
    };
  });
  const total = subtotal; // discount/tax 0 in v1

  // Allocate order_no + insert sale header in one statement (CTE picks MAX+1).
  // Retry on 23505 (unique-constraint race from concurrent writers).
  let saleId: string | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const inserted = (await sql`
        WITH next_no AS (
          SELECT COALESCE(MAX(order_no), 0) + 1 AS n
          FROM public.sales
          WHERE bucket_id = ${clientId}::uuid
        )
        INSERT INTO public.sales (
          bucket_id, order_no, status, channel,
          customer_name, customer_phone, customer_email,
          subtotal_cents, total_cents,
          created_by_user_node, payment_ref
        )
        SELECT ${clientId}::uuid, n, 'pending_payment'::sale_status, ${body.channel}::sale_channel,
               ${body.customer.name}, ${body.customer.phone}, ${body.customer.email ?? null},
               ${subtotal}, ${total},
               ${userNodeId}::uuid, ${IDEM_PREFIX + body.idempotencyKey}
        FROM next_no
        RETURNING id
      `) as Array<{ id: string }>;
      saleId = inserted[0]!.id;
      break;
    } catch (err: any) {
      // Postgres unique_violation code; neon HTTP driver surfaces it as `.code`.
      const code = err?.code ?? err?.cause?.code;
      if (code === '23505' && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
  if (!saleId) return jsonError(500, 'order_no_allocation_failed');

  // Insert sale_lines individually (neon http driver has no batched parameter
  // arrays); the volume is tiny (handful of lines per sale).
  for (const ls of lineSpecs) {
    await sql`
      INSERT INTO public.sale_lines
        (sale_id, product_id, product_name_snap, unit_price_cents, qty, line_total_cents, position)
      VALUES
        (${saleId}::uuid, ${ls.productId}::uuid, ${ls.productName}, ${ls.unitPriceCents},
         ${ls.qty}, ${ls.lineTotalCents}, ${ls.position})
    `;
  }

  await logAudit(sql, {
    session: { kind: 'bucket_user', user_node_id: userNodeId, client_id: clientId, level_number: 1 } as any,
    op: 'pos.sale.created',
    clientId,
    targetType: 'sale',
    targetId: saleId,
    detail: { total_cents: total, channel: body.channel, lines: lineSpecs.length },
  });

  return jsonOk(await loadSaleResponse(sql, saleId), { status: 201 });
}

async function loadSaleResponse(sql: NeonQueryFunction<false, false>, saleId: string) {
  const sales = (await sql`SELECT * FROM public.sales WHERE id = ${saleId}::uuid`) as any[];
  const lines = (await sql`
    SELECT * FROM public.sale_lines WHERE sale_id = ${saleId}::uuid ORDER BY position
  `) as any[];
  return { ...sales[0], lines };
}
