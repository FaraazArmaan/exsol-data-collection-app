// POST /api/public/sales — public, unauthenticated guest checkout.
//
// Handler order matters (spec §5.2):
//   1. rate-limit: 10/min/IP global + 3/10min/IP per slug
//   2. honeypot: a filled `honeypot` field → 200 fake success, no DB write
//      (silent — hides the detection from bots)
//   3. validate body (PublicSaleCreateBody)
//   4. resolve + guard slug → 404 storefront_unavailable
//   5. idempotency replay (payment_ref = 'idem:'+key within 24h)
//   6. hydrate products with the storefront_visible filter
//   7. snapshot server prices, allocate order_no, insert as source='storefront'
//      with created_by_user_node = NULL (DB CHECK enforces the invariant)
//   8. bulk insert sale_lines
//   9. audit (system actor — no user_node, no admin)
//
// Returns 201 with the whitelisted public shape; never exposes internal columns.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { logAudit } from './_shared/audit';
import { resolveStorefront } from './_pub-authz';
import { checkLimit, clientIp } from './_pub-ratelimit';
import { PublicSaleCreateBody } from './_pub-validators';
import { serializePublicSale } from './_pub-serialize';
import { sendMail } from './_shared/mailer';
import type { NeonQueryFunction } from '@neondatabase/serverless';

export const config = { path: '/api/public/sales', method: 'POST' };

const IDEM_PREFIX = 'idem:';
const MAX_ATTEMPTS = 5;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const slugHint = typeof raw?.slug === 'string' ? (raw.slug as string) : '';

  // 1. rate-limit (global + per-slug)
  const rl = await checkLimit(clientIp(req), 'sale', {
    perMinute: 10,
    perSlugIp: slugHint ? { slug: slugHint, per10min: 3 } : undefined,
  });
  if (!rl.ok) return jsonError(429, rl.code);

  // 2. honeypot — checked before zod so a tripped bot gets a believable 200,
  //    not a 400 that reveals the field matters.
  if (typeof raw?.honeypot === 'string' && raw.honeypot !== '') {
    return jsonOk({ id: crypto.randomUUID(), status: 'pending_payment' }, { status: 200 });
  }

  // 3. validate
  let body: PublicSaleCreateBody;
  try {
    body = PublicSaleCreateBody.parse(raw);
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }

  // 4. resolve + guard
  const tenant = await resolveStorefront(body.slug);
  if (!tenant) return jsonError(404, 'storefront_unavailable');
  const clientId = tenant.clientId;

  const sql = db();

  // 5. idempotency replay (no creator filter — storefront sales have none)
  const existing = (await sql`
    SELECT id FROM public.sales
    WHERE bucket_id = ${clientId}::uuid
      AND source = 'storefront'
      AND payment_ref = ${IDEM_PREFIX + body.idempotencyKey}
      AND created_at > now() - interval '24 hours'
    LIMIT 1
  `) as Array<{ id: string }>;
  if (existing[0]) {
    return jsonOk(await loadPublicSale(sql, existing[0].id), { status: 200 });
  }

  // 6. hydrate with storefront visibility filter
  const productIds = body.lines.map((l) => l.productId);
  const rows = (await sql`
    SELECT id, name,
           COALESCE(sale_price_cents, price_cents)::bigint AS unit_price_cents,
           client_id, storefront_visible, deleted_at, status
    FROM public.products
    WHERE id = ANY(${productIds}::uuid[])
  `) as Array<{
    id: string; name: string; unit_price_cents: number | string;
    client_id: string; storefront_visible: boolean; deleted_at: string | null; status: string;
  }>;
  if (rows.length !== productIds.length) return jsonError(400, 'unknown_product');
  if (rows.some((p) => p.client_id !== clientId)) return jsonError(404, 'product_not_found');
  if (rows.some((p) => p.deleted_at || p.status !== 'active' || !p.storefront_visible)) {
    return jsonError(400, 'product_not_visible');
  }

  const byId = new Map(rows.map((p) => [p.id, p]));
  let subtotal = 0;
  const lineSpecs = body.lines.map((l, idx) => {
    const p = byId.get(l.productId)!;
    const unit = Number(p.unit_price_cents);
    const lineTotal = unit * l.qty;
    subtotal += lineTotal;
    return { productId: p.id, productName: p.name, unitPriceCents: unit, qty: l.qty, lineTotalCents: lineTotal, position: idx };
  });
  const total = subtotal; // discount/tax 0 in v2

  // 7. allocate order_no + insert header (retry on 23505 race)
  let saleId: string | null = null;
  let orderNo: number | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const inserted = (await sql`
        WITH next_no AS (
          SELECT COALESCE(MAX(order_no), 0) + 1 AS n
          FROM public.sales WHERE bucket_id = ${clientId}::uuid
        )
        INSERT INTO public.sales (
          bucket_id, order_no, status, channel, source,
          customer_name, customer_phone, customer_email,
          subtotal_cents, total_cents,
          created_by_user_node, payment_ref
        )
        SELECT ${clientId}::uuid, n, 'pending_payment'::sale_status, ${body.channel}::sale_channel, 'storefront',
               ${body.customer.name}, ${body.customer.phone}, ${body.customer.email ?? null},
               ${subtotal}, ${total},
               NULL, ${IDEM_PREFIX + body.idempotencyKey}
        FROM next_no
        RETURNING id, order_no
      `) as Array<{ id: string; order_no: number }>;
      saleId = inserted[0]!.id;
      orderNo = inserted[0]!.order_no;
      break;
    } catch (err: any) {
      const code = err?.code ?? err?.cause?.code;
      if (code === '23505' && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
  if (!saleId) return jsonError(500, 'order_no_allocation_failed');

  // 8. lines
  for (const ls of lineSpecs) {
    await sql`
      INSERT INTO public.sale_lines
        (sale_id, product_id, product_name_snap, unit_price_cents, qty, line_total_cents, position)
      VALUES
        (${saleId}::uuid, ${ls.productId}::uuid, ${ls.productName}, ${ls.unitPriceCents},
         ${ls.qty}, ${ls.lineTotalCents}, ${ls.position})
    `;
  }

  // 9. audit — system actor (no user_node, no admin); kind is intentionally
  //    neither 'admin' nor 'bucket_user' so logAudit records both as NULL.
  await logAudit(sql, {
    session: { kind: 'storefront' } as any,
    op: 'pos.sale.created',
    clientId,
    targetType: 'sale',
    targetId: saleId,
    detail: { source: 'storefront', total_cents: total, channel: body.channel, lines: lineSpecs.length },
  });

  // Storefront receipt — fresh-insert path only (idempotent replays returned at step 5).
  await sendMail({
    clientId,
    to: body.customer.email,
    template: 'storefront_receipt',
    data: {
      customerName: body.customer.name,
      orderNo: orderNo ?? saleId,
      lines: lineSpecs.map((l) => ({
        productName: l.productName, qty: l.qty,
        unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents,
      })),
      subtotalCents: subtotal,
      totalCents: total,
    },
  });

  return jsonOk(await loadPublicSale(sql, saleId), { status: 201 });
}

async function loadPublicSale(sql: NeonQueryFunction<false, false>, saleId: string) {
  const sales = (await sql`SELECT * FROM public.sales WHERE id = ${saleId}::uuid`) as any[];
  const lines = (await sql`
    SELECT * FROM public.sale_lines WHERE sale_id = ${saleId}::uuid ORDER BY position
  `) as any[];
  return serializePublicSale(sales[0], lines);
}
