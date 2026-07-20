import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { isCatalogSellable } from './catalog-read-model';
import { customerKey, evaluateCoupon, type CouponRow } from './coupons';
import { env } from './env';
import { computeTax, type TaxConfig } from './tax';

const ALG = 'HS256';
const TTL_SECONDS = 2 * 60;

export interface PosQuoteInput {
  channel: 'instore' | 'online' | 'pickup';
  customer: { name: string; phone: string; email?: string };
  lines: Array<{ productId: string; variantId?: string; qty: number }>;
  couponCode?: string;
}

export interface PosSaleQuote {
  lines: Array<{ productId: string; variantId?: string; productName: string; variantName?: string; variantSku?: string; unitPriceCents: number; qty: number; lineTotalCents: number; position: number }>;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  taxAddToTotalCents: number;
  taxLabel: string;
  taxInclusive: boolean;
  totalCents: number;
  couponCode?: string;
  couponId?: string;
  couponCustomerKey?: string;
  fingerprint: string;
}

export type PosQuoteFailure = { status: 400 | 404 | 422; code: string };

function secret() {
  return new TextEncoder().encode(env().JWT_SIGNING_SECRET);
}

export async function loadPosSaleQuote(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  body: PosQuoteInput,
): Promise<PosSaleQuote | PosQuoteFailure> {
  const productIds = body.lines.map((line) => line.productId);
  const variantIds = body.lines.flatMap((line) => line.variantId ? [line.variantId] : []);
  const products = (await sql`
    SELECT id, name,
           COALESCE(CASE WHEN sale_price_cents IS NOT NULL AND (sale_starts_at IS NULL OR sale_starts_at <= now()) AND (sale_ends_at IS NULL OR sale_ends_at > now()) THEN sale_price_cents END, price_cents)::bigint AS unit_price_cents,
           client_id, pos_visible, storefront_visible, deleted_at, status
    FROM public.products
    WHERE id = ANY(${productIds}::uuid[])
  `) as Array<{ id: string; name: string; unit_price_cents: number | string; client_id: string; pos_visible: boolean; storefront_visible: boolean; deleted_at: string | null; status: string }>;
  if (products.length !== productIds.length) return { status: 400, code: 'unknown_product' };
  if (products.some((product) => product.client_id !== clientId)) return { status: 404, code: 'product_not_found' };
  if (products.some((product) => !isCatalogSellable(product, 'pos'))) return { status: 400, code: 'product_not_visible' };

  const variants = variantIds.length === 0 ? [] : (await sql`
    SELECT id, product_id, title, sku,
           CASE WHEN sale_price_cents IS NOT NULL AND (sale_starts_at IS NULL OR sale_starts_at <= now()) AND (sale_ends_at IS NULL OR sale_ends_at > now()) THEN sale_price_cents ELSE price_cents END AS unit_price_cents,
           client_id, pos_visible, storefront_visible, status, availability
    FROM public.product_variants
    WHERE id = ANY(${variantIds}::uuid[])
  `) as Array<{ id: string; product_id: string; title: string; sku: string | null; unit_price_cents: number | string | null; client_id: string; pos_visible: boolean; storefront_visible: boolean; status: string; availability: string }>;
  if (variants.length !== variantIds.length) return { status: 400, code: 'unknown_variant' };
  if (variants.some((variant) => variant.client_id !== clientId)) return { status: 404, code: 'variant_not_found' };
  if (variants.some((variant) => variant.status !== 'active' || !variant.pos_visible)) return { status: 400, code: 'variant_not_visible' };
  if (variants.some((variant) => variant.availability === 'out_of_stock' || variant.availability === 'discontinued')) return { status: 400, code: 'variant_not_available' };

  const byId = new Map(products.map((product) => [product.id, product]));
  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  if (body.lines.some((line) => line.variantId && variantsById.get(line.variantId)?.product_id !== line.productId)) {
    return { status: 400, code: 'variant_parent_mismatch' };
  }
  let subtotalCents = 0;
  const lines = body.lines.map((line, position) => {
    const product = byId.get(line.productId)!;
    const variant = line.variantId ? variantsById.get(line.variantId) : undefined;
    const unitPriceCents = variant?.unit_price_cents == null ? Number(product.unit_price_cents) : Number(variant.unit_price_cents);
    const lineTotalCents = unitPriceCents * line.qty;
    subtotalCents += lineTotalCents;
    return { productId: product.id, variantId: variant?.id, productName: product.name, variantName: variant?.title, variantSku: variant?.sku ?? undefined, unitPriceCents, qty: line.qty, lineTotalCents, position };
  });

  let discountCents = 0;
  let coupon: CouponRow | null = null;
  let couponCustomerKey: string | undefined;
  if (body.couponCode) {
    const rows = (await sql`
      SELECT id, code, discount_type, discount_value, min_order_cents, max_redemptions,
             per_customer_limit, redeemed_count, starts_at, expires_at, active
      FROM public.coupons
      WHERE client_id = ${clientId}::uuid AND lower(code) = lower(${body.couponCode})
      LIMIT 1
    `) as CouponRow[];
    coupon = rows[0] ?? null;
    if (!coupon) return { status: 422, code: 'coupon_not_found' };
    const evaluation = evaluateCoupon(coupon, subtotalCents, Date.now());
    if (!evaluation.ok) return { status: 422, code: evaluation.code };
    couponCustomerKey = customerKey(body.customer);
    if (coupon.per_customer_limit != null) {
      const used = (await sql`
        SELECT COUNT(*)::int AS n FROM public.coupon_redemptions
        WHERE coupon_id = ${coupon.id}::uuid AND customer_key = ${couponCustomerKey}
      `) as Array<{ n: number }>;
      if (Number(used[0]?.n ?? 0) >= coupon.per_customer_limit) return { status: 422, code: 'coupon_customer_limit' };
    }
    discountCents = evaluation.discountCents;
  }

  const taxRows = (await sql`
    SELECT enabled, rate_bps, label, inclusive FROM public.client_tax_config
    WHERE client_id = ${clientId}::uuid
  `) as TaxConfig[];
  const taxConfig = taxRows[0] ?? null;
  const tax = computeTax(subtotalCents - discountCents, taxConfig);
  const quote = {
    lines, subtotalCents, discountCents, taxCents: tax.taxCents, taxAddToTotalCents: tax.addToTotalCents,
    taxLabel: taxConfig?.label ?? 'Tax', taxInclusive: taxConfig?.inclusive ?? false,
    totalCents: subtotalCents - discountCents + tax.addToTotalCents,
    couponCode: coupon?.code, couponId: coupon?.id, couponCustomerKey,
  };
  return { ...quote, fingerprint: createHash('sha256').update(JSON.stringify({ ...quote, channel: body.channel })).digest('base64url') };
}

export async function signPosQuote(quote: PosSaleQuote, clientId: string, userNodeId: string): Promise<string> {
  return new SignJWT({ client_id: clientId, user_node_id: userNodeId, fingerprint: quote.fingerprint })
    .setProtectedHeader({ alg: ALG }).setIssuedAt().setExpirationTime(`${TTL_SECONDS}s`).sign(secret());
}

export async function matchesPosQuote(token: string, quote: PosSaleQuote, clientId: string, userNodeId: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
    return payload.client_id === clientId && payload.user_node_id === userNodeId && payload.fingerprint === quote.fingerprint;
  } catch {
    return false;
  }
}

export function quoteResponse(quote: PosSaleQuote, quoteId: string) {
  return {
    quoteId, lines: quote.lines, subtotalCents: quote.subtotalCents, discountCents: quote.discountCents,
    taxCents: quote.taxCents, taxLabel: quote.taxLabel, taxInclusive: quote.taxInclusive,
    totalCents: quote.totalCents, couponCode: quote.couponCode,
  };
}

export async function reservePosQuoteCoupon(sql: NeonQueryFunction<false, false>, quote: PosSaleQuote): Promise<boolean> {
  if (!quote.couponId) return true;
  const rows = (await sql`
    UPDATE public.coupons SET redeemed_count = redeemed_count + 1
    WHERE id = ${quote.couponId}::uuid AND active = true
      AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
    RETURNING id
  `) as Array<{ id: string }>;
  return Boolean(rows[0]);
}
