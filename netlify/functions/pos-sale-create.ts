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
//   - Unit price snapshot uses the active sale price only inside its database-time
//     window, matching the menu read so prices are consistent across surfaces.
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
import { createSaleRazorpayCheckout } from './_payments-checkout';
import { razorpayTestConnectionReady, RazorpayProviderError } from './_payments-razorpay';
import { PaymentsEncryptionUnavailable } from './_payments-secrets';
import { loadPosSaleQuote, matchesPosQuote, quoteResponse, reservePosQuoteCoupon, signPosQuote } from './_shared/pos-sale-quote';
import { reserveSaleInventory } from './_shared/inventory-reservations';
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
  if (body.channel === 'online' && !(await razorpayTestConnectionReady(clientId))) {
    return jsonError(409, 'online_payment_unavailable');
  }

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
    return paymentResponse(clientId, existing[0].id, body.channel, 200);
  }

  const quote = await loadPosSaleQuote(sql, clientId, body);
  if ('code' in quote) return jsonError(quote.status, quote.code);
  if (body.quoteId && !(await matchesPosQuote(body.quoteId, quote, clientId, userNodeId))) {
    return jsonError(409, 'quote_changed', { quote: quoteResponse(quote, await signPosQuote(quote, clientId, userNodeId)) });
  }
  if (!(await reservePosQuoteCoupon(sql, quote))) {
    return jsonError(409, 'quote_changed', { reason: 'coupon_exhausted' });
  }
  const { lines: lineSpecs, subtotalCents: subtotal, discountCents: discount, taxCents, taxAddToTotalCents, totalCents: total } = quote;

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
          subtotal_cents, discount_cents, tax_cents, total_cents,
          created_by_user_node, payment_ref
        )
        SELECT ${clientId}::uuid, n, 'pending_payment'::sale_status, ${body.channel}::sale_channel,
               ${body.customer.name}, ${body.customer.phone}, ${body.customer.email ?? null},
               ${subtotal}, ${discount}, ${taxAddToTotalCents}, ${total},
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
        (sale_id, product_id, variant_id, product_name_snap, variant_name_snap, variant_sku_snap, unit_price_cents, qty, line_total_cents, position)
      VALUES
        (${saleId}::uuid, ${ls.productId}::uuid, ${ls.variantId ?? null}::uuid, ${ls.productName}, ${ls.variantName ?? null}, ${ls.variantSku ?? null}, ${ls.unitPriceCents},
         ${ls.qty}, ${ls.lineTotalCents}, ${ls.position})
    `;
  }

  // Pending orders hold stock but do not reduce on-hand yet. The helper leaves
  // non-stock-tracked catalogue items alone, and atomically refuses a tracked
  // row when another checkout already holds the remaining quantity.
  let inventoryReserved = false;
  try {
    inventoryReserved = await reserveSaleInventory(sql, clientId, saleId);
  } catch (error) {
    await removeFailedSale(sql, clientId, saleId, quote.couponId);
    throw error;
  }
  if (!inventoryReserved) {
    await removeFailedSale(sql, clientId, saleId, quote.couponId);
    return jsonError(409, 'insufficient_stock');
  }

  if (quote.couponId && quote.couponCustomerKey) {
    await sql`
      INSERT INTO public.coupon_redemptions (coupon_id, sale_id, customer_key, discount_cents)
      VALUES (${quote.couponId}::uuid, ${saleId}::uuid, ${quote.couponCustomerKey}, ${discount})
    `;
  }

  await logAudit(sql, {
    session: { kind: 'bucket_user', user_node_id: userNodeId, client_id: clientId } as any,
    op: 'pos.sale.created',
    clientId,
    targetType: 'sale',
    targetId: saleId,
    detail: { total_cents: total, discount_cents: discount, tax_cents: taxCents, channel: body.channel, lines: lineSpecs.length },
  });

  return paymentResponse(clientId, saleId, body.channel, 201);
}

// A reservation failure happens before any payment intent is created. Remove
// the provisional sale and give back the coupon slot that was reserved earlier.
async function removeFailedSale(sql: NeonQueryFunction<false, false>, clientId: string, saleId: string, couponId?: string): Promise<void> {
  await sql`DELETE FROM public.sales WHERE id = ${saleId}::uuid AND bucket_id = ${clientId}::uuid`;
  if (couponId) {
    await sql`
      UPDATE public.coupons SET redeemed_count = GREATEST(0, redeemed_count - 1)
      WHERE id = ${couponId}::uuid AND client_id = ${clientId}::uuid
    `;
  }
}

async function paymentResponse(clientId: string, saleId: string, channel: SaleCreateBody['channel'], status: number): Promise<Response> {
  const sale = await loadSaleResponse(db(), saleId);
  if (channel !== 'online') return jsonOk(sale, { status });
  try {
    const checkout = await createSaleRazorpayCheckout({ clientId, saleId, amountMinor: Number(sale.total_cents) });
    return jsonOk(checkout ? {
      ...sale,
      payment_intent: {
        provider: 'razorpay', status: 'created', amount_cents: checkout.amountMinor,
        currency: checkout.currency, order_id: checkout.orderId, key_id: checkout.keyId, expires_at: checkout.expiresAt,
      },
    } : sale, { status });
  } catch (error) {
    if (error instanceof PaymentsEncryptionUnavailable) return jsonError(503, 'payments_encryption_unavailable');
    if (error instanceof RazorpayProviderError) return jsonError(502, 'payment_provider_unavailable');
    throw error;
  }
}

async function loadSaleResponse(sql: NeonQueryFunction<false, false>, saleId: string) {
  const sales = (await sql`SELECT * FROM public.sales WHERE id = ${saleId}::uuid`) as any[];
  const lines = (await sql`
    SELECT * FROM public.sale_lines WHERE sale_id = ${saleId}::uuid ORDER BY position
  `) as any[];
  return { ...sales[0], lines };
}
