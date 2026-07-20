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
import { evaluateCoupon, customerKey, type CouponRow } from './_shared/coupons';
import { loadBundles } from './_shared/bundles';
import { computeTax, type TaxConfig } from './_shared/tax';
import { createSaleRazorpayCheckout } from './_payments-checkout';
import { razorpayTestConnectionReady, RazorpayProviderError } from './_payments-razorpay';
import { PaymentsEncryptionUnavailable } from './_payments-secrets';
import { isCatalogSellable } from './_shared/catalog-read-model';
import { reserveSaleInventory } from './_shared/inventory-reservations';
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
  if (body.channel === 'online' && !(await razorpayTestConnectionReady(clientId))) {
    return jsonError(409, 'online_payment_unavailable');
  }

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
    return paymentResponse(clientId, existing[0].id, body.channel, 200);
  }

  // 6. hydrate with storefront visibility filter
  const productIds = body.lines.map((l) => l.productId);
  const variantIds = body.lines.flatMap((line) => line.variantId ? [line.variantId] : []);
  const rows = (await sql`
    SELECT id, name,
           COALESCE(CASE WHEN sale_price_cents IS NOT NULL AND (sale_starts_at IS NULL OR sale_starts_at <= now()) AND (sale_ends_at IS NULL OR sale_ends_at > now()) THEN sale_price_cents END, price_cents)::bigint AS unit_price_cents,
           client_id, pos_visible, storefront_visible, deleted_at, status
    FROM public.products
    WHERE id = ANY(${productIds}::uuid[])
  `) as Array<{
    id: string; name: string; unit_price_cents: number | string;
    client_id: string; pos_visible: boolean; storefront_visible: boolean; deleted_at: string | null; status: string;
  }>;
  if (rows.length !== productIds.length) return jsonError(400, 'unknown_product');
  if (rows.some((p) => p.client_id !== clientId)) return jsonError(404, 'product_not_found');
  if (rows.some((p) => !isCatalogSellable(p, 'storefront'))) {
    return jsonError(400, 'product_not_visible');
  }

  const variants = variantIds.length === 0 ? [] : (await sql`
    SELECT id, product_id, title, sku,
           CASE WHEN sale_price_cents IS NOT NULL AND (sale_starts_at IS NULL OR sale_starts_at <= now()) AND (sale_ends_at IS NULL OR sale_ends_at > now()) THEN sale_price_cents ELSE price_cents END AS unit_price_cents,
           client_id, storefront_visible, status, availability
    FROM public.product_variants
    WHERE id = ANY(${variantIds}::uuid[])
  `) as Array<{ id: string; product_id: string; title: string; sku: string | null; unit_price_cents: number | string | null; client_id: string; storefront_visible: boolean; status: string; availability: string }>;
  if (variants.length !== variantIds.length) return jsonError(400, 'unknown_variant');
  if (variants.some((variant) => variant.client_id !== clientId)) return jsonError(404, 'variant_not_found');
  if (variants.some((variant) => variant.status !== 'active' || !variant.storefront_visible)) return jsonError(400, 'variant_not_visible');
  if (variants.some((variant) => variant.availability === 'out_of_stock' || variant.availability === 'discontinued')) return jsonError(400, 'variant_not_available');

  // Bundle stock guard — a bundle whose components can't cover the order is not
  // sellable. Same derivation the storefront used to grey the tile out.
  const bundles = await loadBundles(sql, clientId, productIds);
  for (const [bundleId, info] of bundles) {
    if (!info.inStock) return jsonError(400, 'bundle_out_of_stock', { productId: bundleId });
  }

  const byId = new Map(rows.map((p) => [p.id, p]));
  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  if (body.lines.some((line) => line.variantId && variantsById.get(line.variantId)?.product_id !== line.productId)) {
    return jsonError(400, 'variant_parent_mismatch');
  }
  let subtotal = 0;
  const lineSpecs = body.lines.map((l, idx) => {
    const p = byId.get(l.productId)!;
    const variant = l.variantId ? variantsById.get(l.variantId) : undefined;
    const unit = variant?.unit_price_cents == null ? Number(p.unit_price_cents) : Number(variant.unit_price_cents);
    const lineTotal = unit * l.qty;
    subtotal += lineTotal;
    return { productId: p.id, variantId: variant?.id, productName: p.name, variantName: variant?.title, variantSku: variant?.sku ?? undefined, unitPriceCents: unit, qty: l.qty, lineTotalCents: lineTotal, position: idx };
  });
  // ── Coupon (optional) ──────────────────────────────────────────────────────
  // Re-evaluated here against server prices and the live redeemed_count — the
  // storefront preview is never trusted into a discount. The global cap is
  // reserved with a conditional UPDATE (race-safe); the per-customer cap is a
  // best-effort count (documented TOCTOU, acceptable for storefront promos).
  let discount = 0;
  let redemption: { couponId: string; key: string } | null = null;
  if (body.couponCode) {
    const crows = (await sql`
      SELECT id, code, discount_type, discount_value, min_order_cents, max_redemptions,
             per_customer_limit, redeemed_count, starts_at, expires_at, active
      FROM public.coupons
      WHERE client_id = ${clientId}::uuid AND lower(code) = lower(${body.couponCode})
      LIMIT 1
    `) as CouponRow[];
    const coupon = crows[0];
    if (!coupon) return jsonError(422, 'coupon_not_found');
    const ev = evaluateCoupon(coupon, subtotal, Date.now());
    if (!ev.ok) return jsonError(422, ev.code);

    const key = customerKey(body.customer);
    if (coupon.per_customer_limit != null) {
      const used = (await sql`
        SELECT COUNT(*)::int AS n FROM public.coupon_redemptions
        WHERE coupon_id = ${coupon.id}::uuid AND customer_key = ${key}
      `) as Array<{ n: number }>;
      if (Number(used[0]?.n ?? 0) >= coupon.per_customer_limit) return jsonError(422, 'coupon_customer_limit');
    }

    // Reserve a redemption slot atomically — closes the global-cap race.
    const bumped = (await sql`
      UPDATE public.coupons SET redeemed_count = redeemed_count + 1
      WHERE id = ${coupon.id}::uuid
        AND active = true
        AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
      RETURNING id
    `) as Array<{ id: string }>;
    if (!bumped[0]) return jsonError(422, 'coupon_exhausted');

    discount = ev.discountCents;
    redemption = { couponId: coupon.id, key };
  }
  // ── Tax (optional, per-client) ─────────────────────────────────────────────
  // Applied to the post-discount taxable amount. Exclusive tax adds to the total;
  // inclusive tax is extracted for the line but leaves the total unchanged.
  const taxable = subtotal - discount;
  const taxCfg = (await sql`
    SELECT enabled, rate_bps, label, inclusive FROM public.client_tax_config
    WHERE client_id = ${clientId}::uuid
  `) as TaxConfig[];
  const tax = computeTax(taxable, taxCfg[0] ?? null);
  const total = taxable + tax.addToTotalCents;

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
          subtotal_cents, discount_cents, tax_cents, total_cents,
          created_by_user_node, payment_ref
        )
        SELECT ${clientId}::uuid, n, 'pending_payment'::sale_status, ${body.channel}::sale_channel, 'storefront',
               ${body.customer.name}, ${body.customer.phone}, ${body.customer.email ?? null},
               ${subtotal}, ${discount}, ${tax.addToTotalCents}, ${total},
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
        (sale_id, product_id, variant_id, product_name_snap, variant_name_snap, variant_sku_snap, unit_price_cents, qty, line_total_cents, position)
      VALUES
        (${saleId}::uuid, ${ls.productId}::uuid, ${ls.variantId ?? null}::uuid, ${ls.productName}, ${ls.variantName ?? null}, ${ls.variantSku ?? null}, ${ls.unitPriceCents},
         ${ls.qty}, ${ls.lineTotalCents}, ${ls.position})
    `;
  }

  // Storefront and staff checkout share the same stock boundary: a pending
  // order reserves tracked inventory, while a product without an Inventory row
  // remains a non-stock-tracked catalogue item.
  let inventoryReserved = false;
  try {
    inventoryReserved = await reserveSaleInventory(sql, clientId, saleId);
  } catch (error) {
    await removeFailedSale(sql, clientId, saleId, redemption?.couponId);
    throw error;
  }
  if (!inventoryReserved) {
    await removeFailedSale(sql, clientId, saleId, redemption?.couponId);
    return jsonError(409, 'insufficient_stock');
  }

  // Record the coupon redemption against the sale (the slot was reserved above).
  if (redemption) {
    await sql`
      INSERT INTO public.coupon_redemptions (coupon_id, sale_id, customer_key, discount_cents)
      VALUES (${redemption.couponId}::uuid, ${saleId}::uuid, ${redemption.key}, ${discount})
    `;
  }

  // Flip any persisted abandoned cart for this session to 'converted' so the
  // cron never nudges a guest who completed the order.
  await sql`
    UPDATE public.abandoned_carts
    SET status = 'converted', converted_at = now()
    WHERE client_id = ${clientId}::uuid AND session_key = ${body.idempotencyKey} AND status <> 'converted'
  `;

  // 9. audit — system actor (no user_node, no admin); kind is intentionally
  //    neither 'admin' nor 'bucket_user' so logAudit records both as NULL.
  await logAudit(sql, {
    session: { kind: 'storefront' } as any,
    op: 'pos.sale.created',
    clientId,
    targetType: 'sale',
    targetId: saleId,
    detail: { source: 'storefront', total_cents: total, discount_cents: discount, tax_cents: tax.taxCents, channel: body.channel, lines: lineSpecs.length },
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
      discountCents: discount || undefined,
      // Additive tax only on the receipt (matches the stored row + total). An
      // inclusive tax is already baked into the prices, so it isn't a line here.
      taxCents: tax.addToTotalCents || undefined,
      totalCents: total,
    },
  });

  return paymentResponse(clientId, saleId, body.channel, 201);
}

async function removeFailedSale(sql: NeonQueryFunction<false, false>, clientId: string, saleId: string, couponId?: string): Promise<void> {
  await sql`DELETE FROM public.sales WHERE id = ${saleId}::uuid AND bucket_id = ${clientId}::uuid`;
  if (couponId) {
    await sql`
      UPDATE public.coupons SET redeemed_count = GREATEST(0, redeemed_count - 1)
      WHERE id = ${couponId}::uuid AND client_id = ${clientId}::uuid
    `;
  }
}

async function paymentResponse(clientId: string, saleId: string, channel: PublicSaleCreateBody['channel'], status: number): Promise<Response> {
  const sale = await loadPublicSale(db(), saleId);
  if (channel !== 'online') return jsonOk(sale, { status });
  try {
    const checkout = await createSaleRazorpayCheckout({ clientId, saleId, amountMinor: sale.totalCents });
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

async function loadPublicSale(sql: NeonQueryFunction<false, false>, saleId: string) {
  const sales = (await sql`SELECT * FROM public.sales WHERE id = ${saleId}::uuid`) as any[];
  const lines = (await sql`
    SELECT * FROM public.sale_lines WHERE sale_id = ${saleId}::uuid ORDER BY position
  `) as any[];
  return serializePublicSale(sales[0], lines);
}
