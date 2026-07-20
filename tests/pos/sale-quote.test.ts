import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import quoteHandler from '../../netlify/functions/pos-sale-quote';
import saleHandler from '../../netlify/functions/pos-sale-create';
import { makeBucketUserRequest, seedClientWithProductsEnabled, seedProducts } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

describe('POST /api/pos/sale-quote', () => {
  it('rehydrates a variant price and snapshots the selected variant on the sale line', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const [productId] = await seedProducts(ctx.clientId, [{ name: 'Variant tee', price_cents: 2000 }]);
    const variants = await sql`
      INSERT INTO public.product_variants (client_id, product_id, title, option_values, sku, price_cents, status)
      VALUES (${ctx.clientId}::uuid, ${productId}::uuid, 'Medium / Blue', '{"size":"M","color":"Blue"}'::jsonb, 'TEE-M-BLUE', 2500, 'active')
      RETURNING id
    ` as Array<{ id: string }>;
    const body = { channel: 'instore' as const, customer: { name: 'Riya', phone: `9${Math.random().toString().slice(2, 11)}` }, lines: [{ productId, variantId: variants[0]!.id, qty: 2 }] };
    const quoteRes = await quoteHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sale-quote', body));
    expect(quoteRes.status).toBe(200);
    const quote = (await quoteRes.json()) as { quoteId: string; totalCents: number; lines: Array<{ variantId: string; variantName: string; variantSku: string }> };
    expect(quote.totalCents).toBe(5000);
    expect(quote.lines[0]).toMatchObject({ variantId: variants[0]!.id, variantName: 'Medium / Blue', variantSku: 'TEE-M-BLUE' });
    const sale = await saleHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', { ...body, idempotencyKey: crypto.randomUUID(), quoteId: quote.quoteId }));
    expect(sale.status).toBe(201);
    const saleId = (await sale.json() as { id: string }).id;
    const lines = await sql`SELECT variant_id, variant_name_snap, variant_sku_snap, unit_price_cents FROM public.sale_lines WHERE sale_id = ${saleId}::uuid` as Array<{ variant_id: string; variant_name_snap: string; variant_sku_snap: string; unit_price_cents: number }>;
    expect(lines[0]).toMatchObject({ variant_id: variants[0]!.id, variant_name_snap: 'Medium / Blue', variant_sku_snap: 'TEE-M-BLUE' });
    expect(Number(lines[0]!.unit_price_cents)).toBe(2500);
  });

  it('does not quote an out-of-stock variant even when its parent remains visible', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const [productId] = await seedProducts(ctx.clientId, [{ name: 'Unavailable variant tee', price_cents: 2000 }]);
    const variants = await sql`
      INSERT INTO public.product_variants (client_id, product_id, title, option_values, status, availability)
      VALUES (${ctx.clientId}::uuid, ${productId}::uuid, 'Medium', '{"size":"M"}'::jsonb, 'active', 'out_of_stock')
      RETURNING id
    ` as Array<{ id: string }>;
    const res = await quoteHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sale-quote', {
      channel: 'instore', customer: { name: 'Riya', phone: `9${Math.random().toString().slice(2, 11)}` },
      lines: [{ productId, variantId: variants[0]!.id, qty: 1 }],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'variant_not_available' } });
  });

  it('returns a signed current breakdown and final sale rejects a changed price without writing', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const [productId] = await seedProducts(ctx.clientId, [{ name: 'Quoted cap', price_cents: 20000, sale_price_cents: 15000 }]);
    const body = { channel: 'instore' as const, customer: { name: 'Riya', phone: `9${Math.random().toString().slice(2, 11)}` }, lines: [{ productId, qty: 1 }] };
    const quoteRes = await quoteHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sale-quote', body));
    expect(quoteRes.status).toBe(200);
    const quote = (await quoteRes.json()) as { quoteId: string; totalCents: number };
    expect(quote.totalCents).toBe(15000);

    await sql`UPDATE public.products SET sale_price_cents = 12500 WHERE id = ${productId}::uuid`;
    const before = await sql`SELECT count(*)::int AS n FROM public.sales WHERE bucket_id = ${ctx.clientId}::uuid` as Array<{ n: number }>;
    const saleRes = await saleHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', { ...body, idempotencyKey: crypto.randomUUID(), quoteId: quote.quoteId }));
    expect(saleRes.status).toBe(409);
    const failure = (await saleRes.json()) as { error: { code: string; details: { quote: { totalCents: number } } } };
    expect(failure.error.code).toBe('quote_changed');
    expect(failure.error.details.quote.totalCents).toBe(12500);
    const after = await sql`SELECT count(*)::int AS n FROM public.sales WHERE bucket_id = ${ctx.clientId}::uuid` as Array<{ n: number }>;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
