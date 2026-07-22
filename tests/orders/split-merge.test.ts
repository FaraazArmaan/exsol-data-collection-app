// tests/orders/split-merge.test.ts — Split-merge Engine (Task 6)
import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { seedOrdersClient, seedSale, seedStock, seedProducts, makeBucketUserRequest } from './_helpers';
import splitHandler from '../../netlify/functions/orders-split';
import fulfillmentsHandler from '../../netlify/functions/orders-fulfillments';
import fulfillmentAdvanceHandler from '../../netlify/functions/orders-fulfillment-advance';
import mergeHandler from '../../netlify/functions/orders-merge';
import saleLinesHandler from '../../netlify/functions/orders-sale-lines';

const sql = neon(process.env.DATABASE_URL!);

// Insert sale_lines for a sale. Returns line ids in insertion order.
async function seedSaleLines(
  saleId: string,
  lines: Array<{ productId: string; productName: string; qty: number; unitPriceCents: number; variantId?: string; variantName?: string; variantSku?: string }>,
): Promise<string[]> {
  const ids: string[] = [];
  let position = 1;
  for (const l of lines) {
    const lineTotalCents = l.unitPriceCents * l.qty;
    const rows = (await sql`
      INSERT INTO public.sale_lines
        (sale_id, product_id, variant_id, product_name_snap, variant_name_snap, variant_sku_snap, unit_price_cents, qty, line_total_cents, position)
      VALUES
        (${saleId}::uuid, ${l.productId}::uuid, ${l.variantId ?? null}::uuid, ${l.productName}, ${l.variantName ?? null}, ${l.variantSku ?? null},
         ${l.unitPriceCents}, ${l.qty}, ${lineTotalCents}, ${position})
      RETURNING id
    `) as Array<{ id: string }>;
    ids.push(rows[0]!.id);
    position++;
  }
  return ids;
}

// Create a same-phone paid sale directly (seedSale generates random phone each time).
async function seedPaidSaleWithPhone(
  clientId: string,
  userNodeId: string,
  phone: string,
  totalCents = 1000,
): Promise<string> {
  const orderNo = Math.floor(200000 + Math.random() * 800000);
  const rows = (await sql`
    INSERT INTO public.sales
      (bucket_id, order_no, status, channel, customer_name, customer_phone,
       subtotal_cents, discount_cents, tax_cents, total_cents, created_by_user_node)
    VALUES
      (${clientId}::uuid, ${orderNo}, 'paid'::sale_status, 'instore'::sale_channel,
       'Merge Test Customer', ${phone}, ${totalCents}, 0, 0, ${totalCents},
       ${userNodeId}::uuid)
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

describe('orders split', () => {
  it('rejects an in-store sale because POS completes it immediately', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', channel: 'instore' });

    const res = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Not an Orders shipment', lines: [] }],
      }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('orders_fulfillment_not_required');
  });

  it('POST split → 201, returns fulfillment_ids array (valid 2+3 / 3 partition of qty-5 line)', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 4000 });
    const [prodAId, prodBId] = await seedProducts(ctx.clientId, [
      { name: `Split Product A ${Math.random().toString(36).slice(2)}`, price_cents: 500 },
      { name: `Split Product B ${Math.random().toString(36).slice(2)}`, price_cents: 500 },
    ]);
    const [lineAId, lineBId] = await seedSaleLines(saleId, [
      { productId: prodAId!, productName: 'Product A', qty: 5, unitPriceCents: 500 },
      { productId: prodBId!, productName: 'Product B', qty: 3, unitPriceCents: 500 },
    ]);

    // fulfillment 1: lineA=2, lineB=3; fulfillment 2: lineA=3  (2+3=5 ≤ qty 5 ✓)
    const res = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [
          { label: 'Box 1', lines: [{ sale_line_id: lineAId, qty: 2 }, { sale_line_id: lineBId, qty: 3 }] },
          { label: 'Box 2', lines: [{ sale_line_id: lineAId, qty: 3 }] },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(Array.isArray(body.fulfillment_ids)).toBe(true);
    expect(body.fulfillment_ids).toHaveLength(2);
  });

  it('over-allocation (line A total 6 > qty 5) → 409 over_fulfillment with sale_line_id', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 2500 });
    const [prodAId] = await seedProducts(ctx.clientId, [
      { name: `Overalloc Product ${Math.random().toString(36).slice(2)}`, price_cents: 500 },
    ]);
    const [lineAId] = await seedSaleLines(saleId, [
      { productId: prodAId!, productName: 'Product A', qty: 5, unitPriceCents: 500 },
    ]);

    // 3 + 3 = 6 > 5 → over_fulfillment
    const res = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [
          { label: 'Box 1', lines: [{ sale_line_id: lineAId, qty: 3 }] },
          { label: 'Box 2', lines: [{ sale_line_id: lineAId, qty: 3 }] },
        ],
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('over_fulfillment');
    expect(body.error.details.sale_line_id).toBe(lineAId);
  });

  it('sale_line_id not belonging to this sale → 409', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1000 });
    const { saleId: otherSaleId } = await seedSale(ctx, { status: 'paid', total: 1000 });
    const [prodId] = await seedProducts(ctx.clientId, [
      { name: `Foreign Line ${Math.random().toString(36).slice(2)}`, price_cents: 200 },
    ]);
    const [otherLineId] = await seedSaleLines(otherSaleId, [
      { productId: prodId!, productName: 'Other', qty: 1, unitPriceCents: 200 },
    ]);

    const res = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [
          { label: 'Box 1', lines: [{ sale_line_id: otherLineId, qty: 1 }] },
        ],
      }),
    );
    expect(res.status).toBe(409);
  });

  it('foreign sale → 404', async () => {
    const ctx = await seedOrdersClient();
    const otherCtx = await seedOrdersClient();
    const { saleId: otherSaleId } = await seedSale(otherCtx, { status: 'paid', total: 1000 });

    const res = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${otherSaleId}`, {
        fulfillments: [{ label: 'Box 1', lines: [] }],
      }),
    );
    expect(res.status).toBe(404);
  });

  it('bad uuid → 404', async () => {
    const ctx = await seedOrdersClient();
    const res = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/split/not-a-uuid', {
        fulfillments: [{ label: 'Box 1', lines: [] }],
      }),
    );
    expect(res.status).toBe(404);
  });

  it('cross-request over-fulfillment: split(6)→201, split(5)→409, split(4)→201 on qty=10 line', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 5000 });
    const [prodId] = await seedProducts(ctx.clientId, [
      { name: `XR Product ${Math.random().toString(36).slice(2)}`, price_cents: 500 },
    ]);
    const [lineId] = await seedSaleLines(saleId, [
      { productId: prodId!, productName: 'XR Product', qty: 10, unitPriceCents: 500 },
    ]);

    // Split #1: qty=6 → 201 (0 existing + 6 = 6 ≤ 10)
    const res1 = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Box 1', lines: [{ sale_line_id: lineId, qty: 6 }] }],
      }),
    );
    expect(res1.status).toBe(201);

    // Split #2: qty=5 → 409 (6 already allocated + 5 = 11 > 10)
    const res2 = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Box 2', lines: [{ sale_line_id: lineId, qty: 5 }] }],
      }),
    );
    expect(res2.status).toBe(409);
    const body2 = await res2.json();
    expect(body2.error.code).toBe('over_fulfillment');
    expect(body2.error.details.sale_line_id).toBe(lineId);

    // Split #3: qty=4 → 201 (6 + 4 = 10, exactly at the line qty)
    const res3 = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Box 3', lines: [{ sale_line_id: lineId, qty: 4 }] }],
      }),
    );
    expect(res3.status).toBe(201);
  });

  it('cancelled fulfillment qty does not count against the cap', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 5000 });
    const [prodId] = await seedProducts(ctx.clientId, [
      { name: `Cancel Cap ${Math.random().toString(36).slice(2)}`, price_cents: 500 },
    ]);
    const [lineId] = await seedSaleLines(saleId, [
      { productId: prodId!, productName: 'Cancel Cap', qty: 10, unitPriceCents: 500 },
    ]);

    // Split #1: qty=6 → 201
    const res1 = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Cancel Box', lines: [{ sale_line_id: lineId, qty: 6 }] }],
      }),
    );
    expect(res1.status).toBe(201);
    const { fulfillment_ids: [fulfillmentId] } = await res1.json();

    // Cap is active: qty=5 → 409 (6 existing + 5 = 11 > 10)
    const res2 = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Over Box', lines: [{ sale_line_id: lineId, qty: 5 }] }],
      }),
    );
    expect(res2.status).toBe(409);
    expect((await res2.json()).error.code).toBe('over_fulfillment');

    // Cancel the first fulfillment (pending → cancelled is a valid direct transition)
    const cancelRes = await fulfillmentAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to: 'cancelled' }),
    );
    expect(cancelRes.status).toBe(200);
    expect((await cancelRes.json()).status).toBe('cancelled');

    // Cancelled qty is excluded — full qty=10 now succeeds
    const res3 = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Freed Box', lines: [{ sale_line_id: lineId, qty: 10 }] }],
      }),
    );
    expect(res3.status).toBe(201);
  });

  it('fractional qty (1.5) → 400 invalid_qty', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1000 });
    const [prodId] = await seedProducts(ctx.clientId, [
      { name: `Frac Qty ${Math.random().toString(36).slice(2)}`, price_cents: 200 },
    ]);
    const [lineId] = await seedSaleLines(saleId, [
      { productId: prodId!, productName: 'Frac Product', qty: 5, unitPriceCents: 200 },
    ]);

    const res = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [
          { label: 'Box 1', lines: [{ sale_line_id: lineId, qty: 1.5 }] },
        ],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_qty');
  });
});

describe('orders fulfillments list', () => {
  it('GET fulfillments?sale_id= → 200, returns fulfillments with lines', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 2000 });
    const [prodId] = await seedProducts(ctx.clientId, [
      { name: `List Fulfil ${Math.random().toString(36).slice(2)}`, price_cents: 400 },
    ]);
    const [lineId] = await seedSaleLines(saleId, [
      { productId: prodId!, productName: 'Product', qty: 2, unitPriceCents: 400 },
    ]);

    const splitRes = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Box Alpha', lines: [{ sale_line_id: lineId, qty: 2 }] }],
      }),
    );
    expect(splitRes.status).toBe(201);
    await seedStock(ctx, prodId!, 2);
    await sql`
      UPDATE public.inventory_stock SET qty_reserved = 1
      WHERE client_id = ${ctx.clientId}::uuid AND product_id = ${prodId!}::uuid AND variant_id IS NULL
    `;
    await sql`
      INSERT INTO public.inventory_reservations (client_id, sale_id, sale_line_id, product_id, qty, qty_consumed)
      VALUES (${ctx.clientId}::uuid, ${saleId}::uuid, ${lineId}::uuid, ${prodId!}::uuid, 2, 1)
    `;

    const res = await fulfillmentsHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/fulfillments?sale_id=${saleId}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((f: { sale_id: string }) => f.sale_id === saleId);
    expect(found).toBeDefined();
    expect(found.label).toBe('Box Alpha');
    expect(found.status).toBe('pending');
    expect(Array.isArray(found.lines)).toBe(true);
    expect(found.lines).toHaveLength(1);
    expect(found.lines[0].qty).toBe(2);
    expect(found.lines[0]).toMatchObject({ fulfilled_qty: 1, remaining_qty: 1, shipped_qty: 0 });
  });

  it('GET fulfillments (no sale_id filter) → 200 array scoped to client', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1500 });
    const [prodId] = await seedProducts(ctx.clientId, [
      { name: `NoFilter ${Math.random().toString(36).slice(2)}`, price_cents: 300 },
    ]);
    const [lineId] = await seedSaleLines(saleId, [
      { productId: prodId!, productName: 'NF Product', qty: 1, unitPriceCents: 300 },
    ]);

    await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'NF Box', lines: [{ sale_line_id: lineId, qty: 1 }] }],
      }),
    );

    const res = await fulfillmentsHandler(
      makeBucketUserRequest(ctx, 'GET', '/api/orders/fulfillments'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((f: { sale_id: string }) => f.sale_id === saleId);
    expect(found).toBeDefined();
  });
});

describe('orders fulfillment-advance', () => {
  it('consumes a variant reservation across split fulfillments and closes the sale only after the final shipment', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', channel: 'pickup', total: 5000 });
    const [productId] = await seedProducts(ctx.clientId, [{ name: `Variant fulfil ${Math.random().toString(36).slice(2)}`, price_cents: 1000 }]);
    const variants = await sql`
      INSERT INTO public.product_variants (client_id, product_id, title, option_values, sku, status)
      VALUES (${ctx.clientId}::uuid, ${productId}::uuid, 'Large / Blue', '{"size":"L","color":"Blue"}'::jsonb, 'FULFIL-L-BLUE', 'active')
      RETURNING id
    ` as Array<{ id: string }>;
    const variantId = variants[0]!.id;
    const [lineId] = await seedSaleLines(saleId, [{
      productId: productId!, productName: 'Variant fulfil', variantId, variantName: 'Large / Blue', variantSku: 'FULFIL-L-BLUE', qty: 5, unitPriceCents: 1000,
    }]);
    await sql`
      INSERT INTO public.inventory_stock (client_id, product_id, variant_id, qty_on_hand, qty_reserved)
      VALUES (${ctx.clientId}::uuid, ${productId}::uuid, ${variantId}::uuid, 5, 5)
    `;
    await sql`
      INSERT INTO public.inventory_reservations (client_id, sale_id, sale_line_id, product_id, variant_id, qty)
      VALUES (${ctx.clientId}::uuid, ${saleId}::uuid, ${lineId}::uuid, ${productId}::uuid, ${variantId}::uuid, 5)
    `;

    const split = await splitHandler(makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
      fulfillments: [
        { label: 'First shipment', lines: [{ sale_line_id: lineId, qty: 2 }] },
        { label: 'Final shipment', lines: [{ sale_line_id: lineId, qty: 3 }] },
      ],
    }));
    expect(split.status).toBe(201);
    const { fulfillment_ids: [firstId, finalId] } = await split.json() as { fulfillment_ids: string[] };

    for (const to of ['picked', 'packed', 'shipped', 'fulfilled']) {
      expect((await fulfillmentAdvanceHandler(makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${firstId}`, { to }))).status).toBe(200);
    }
    const afterFirst = await sql`
      SELECT qty_on_hand, qty_reserved FROM public.inventory_stock
      WHERE client_id = ${ctx.clientId}::uuid AND variant_id = ${variantId}::uuid
    ` as Array<{ qty_on_hand: number; qty_reserved: number }>;
    expect(afterFirst[0]).toMatchObject({ qty_on_hand: 3, qty_reserved: 3 });
    const reservationAfterFirst = await sql`
      SELECT qty, qty_consumed, status FROM public.inventory_reservations WHERE sale_line_id = ${lineId}::uuid
    ` as Array<{ qty: number; qty_consumed: number; status: string }>;
    expect(reservationAfterFirst[0]).toMatchObject({ qty: 5, qty_consumed: 2, status: 'reserved' });
    expect((await sql`SELECT status FROM public.sales WHERE id = ${saleId}::uuid` as Array<{ status: string }>)[0]!.status).toBe('paid');

    for (const to of ['picked', 'packed', 'shipped', 'fulfilled']) {
      expect((await fulfillmentAdvanceHandler(makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${finalId}`, { to }))).status).toBe(200);
    }
    const afterFinal = await sql`
      SELECT qty_on_hand, qty_reserved FROM public.inventory_stock
      WHERE client_id = ${ctx.clientId}::uuid AND variant_id = ${variantId}::uuid
    ` as Array<{ qty_on_hand: number; qty_reserved: number }>;
    expect(afterFinal[0]).toMatchObject({ qty_on_hand: 0, qty_reserved: 0 });
    const reservationAfterFinal = await sql`
      SELECT qty_consumed, status FROM public.inventory_reservations WHERE sale_line_id = ${lineId}::uuid
    ` as Array<{ qty_consumed: number; status: string }>;
    expect(reservationAfterFinal[0]).toMatchObject({ qty_consumed: 5, status: 'consumed' });
    expect((await sql`SELECT status FROM public.sales WHERE id = ${saleId}::uuid` as Array<{ status: string }>)[0]!.status).toBe('fulfilled');
    const movements = await sql`
      SELECT variant_id, qty_delta FROM public.stock_movements
      WHERE client_id = ${ctx.clientId}::uuid AND ref IN (${`fulfillment:${firstId}`}, ${`fulfillment:${finalId}`})
      ORDER BY created_at
    ` as Array<{ variant_id: string; qty_delta: number }>;
    expect(movements).toMatchObject([{ variant_id: variantId, qty_delta: -2 }, { variant_id: variantId, qty_delta: -3 }]);
  });

  it('pending→picked→packed→shipped→fulfilled: stock consumed, movement ref=fulfillment:<id>', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 2000 });
    const [prodId] = await seedProducts(ctx.clientId, [
      { name: `Advance Product ${Math.random().toString(36).slice(2)}`, price_cents: 400 },
    ]);
    const [lineId] = await seedSaleLines(saleId, [
      { productId: prodId!, productName: 'Adv Product', qty: 2, unitPriceCents: 400 },
    ]);
    await seedStock(ctx, prodId!, 10);

    const splitRes = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Box Advance', lines: [{ sale_line_id: lineId, qty: 2 }] }],
      }),
    );
    expect(splitRes.status).toBe(201);
    const { fulfillment_ids: [fulfillmentId] } = await splitRes.json();

    // pending → picked
    let advRes = await fulfillmentAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to: 'picked' }),
    );
    expect(advRes.status).toBe(200);
    expect((await advRes.json()).status).toBe('picked');

    // picked → packed
    advRes = await fulfillmentAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to: 'packed' }),
    );
    expect(advRes.status).toBe(200);
    expect((await advRes.json()).status).toBe('packed');

    // packed → shipped
    advRes = await fulfillmentAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to: 'shipped' }),
    );
    expect(advRes.status).toBe(200);
    expect((await advRes.json()).status).toBe('shipped');

    // shipped → fulfilled: consumes stock
    advRes = await fulfillmentAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to: 'fulfilled' }),
    );
    expect(advRes.status).toBe(200);
    const advBody = await advRes.json();
    expect(advBody.status).toBe('fulfilled');
    expect(advBody.fulfilled_at).toBeTruthy();

    // Stock decremented: 10 - 2 = 8
    const stockRows = (await sql`
      SELECT qty_on_hand FROM public.inventory_stock
      WHERE client_id = ${ctx.clientId}::uuid AND product_id = ${prodId}::uuid
    `) as Array<{ qty_on_hand: number }>;
    expect(Number(stockRows[0]!.qty_on_hand)).toBe(8);

    // Movement row with ref='fulfillment:<id>', qty_delta=-2, type='sale'
    const movements = (await sql`
      SELECT qty_delta, type, ref FROM public.stock_movements
      WHERE client_id = ${ctx.clientId}::uuid AND product_id = ${prodId}::uuid
        AND ref = ${'fulfillment:' + fulfillmentId}
    `) as Array<{ qty_delta: number; type: string; ref: string }>;
    expect(movements).toHaveLength(1);
    expect(Number(movements[0]!.qty_delta)).toBe(-2);
    expect(movements[0]!.type).toBe('sale');
  });

  it('fulfil with insufficient stock → 409 insufficient_stock, nothing written', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 3000 });
    const [prodId] = await seedProducts(ctx.clientId, [
      { name: `Insuf Stock ${Math.random().toString(36).slice(2)}`, price_cents: 600 },
    ]);
    const [lineId] = await seedSaleLines(saleId, [
      { productId: prodId!, productName: 'Insuf Product', qty: 5, unitPriceCents: 600 },
    ]);
    // Stock = 2, need = 5
    await seedStock(ctx, prodId!, 2);

    const splitRes = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Insuf Box', lines: [{ sale_line_id: lineId, qty: 5 }] }],
      }),
    );
    expect(splitRes.status).toBe(201);
    const { fulfillment_ids: [fulfillmentId] } = await splitRes.json();

    // Advance to shipped first
    for (const to of ['picked', 'packed', 'shipped'] as const) {
      const r = await fulfillmentAdvanceHandler(
        makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to }),
      );
      expect(r.status).toBe(200);
    }

    // Try to fulfil — insufficient stock
    const res = await fulfillmentAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to: 'fulfilled' }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('insufficient_stock');
    expect(body.error.details.shortfalls).toHaveLength(1);
    expect(body.error.details.shortfalls[0].have).toBe(2);
    expect(body.error.details.shortfalls[0].need).toBe(5);

    // Stock unchanged — still 2
    const stockRows = (await sql`
      SELECT qty_on_hand FROM public.inventory_stock
      WHERE client_id = ${ctx.clientId}::uuid AND product_id = ${prodId}::uuid
    `) as Array<{ qty_on_hand: number }>;
    expect(Number(stockRows[0]!.qty_on_hand)).toBe(2);

    // No movement row written
    const movements = (await sql`
      SELECT id FROM public.stock_movements
      WHERE client_id = ${ctx.clientId}::uuid AND product_id = ${prodId}::uuid
        AND ref = ${'fulfillment:' + fulfillmentId}
    `) as Array<{ id: string }>;
    expect(movements).toHaveLength(0);

    // Fulfillment still at 'shipped' (not fulfilled)
    const fulfRows = (await sql`
      SELECT status FROM public.orders_fulfillments WHERE id = ${fulfillmentId}::uuid
    `) as Array<{ status: string }>;
    expect(fulfRows[0]!.status).toBe('shipped');
  });

  it('illegal transition (pending → shipped) → 409 illegal_transition', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1000 });
    const [prodId] = await seedProducts(ctx.clientId, [
      { name: `Illegal Trans ${Math.random().toString(36).slice(2)}`, price_cents: 200 },
    ]);
    const [lineId] = await seedSaleLines(saleId, [
      { productId: prodId!, productName: 'IT Product', qty: 1, unitPriceCents: 200 },
    ]);

    const splitRes = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Illegal Box', lines: [{ sale_line_id: lineId, qty: 1 }] }],
      }),
    );
    expect(splitRes.status).toBe(201);
    const { fulfillment_ids: [fulfillmentId] } = await splitRes.json();

    // pending → shipped (illegal — must go through picked/packed)
    const res = await fulfillmentAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to: 'shipped' }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('illegal_transition');
  });

  it('fulfilled → shipped (terminal) → 409 illegal_transition', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1000 });
    const [prodId] = await seedProducts(ctx.clientId, [
      { name: `Terminal Trans ${Math.random().toString(36).slice(2)}`, price_cents: 200 },
    ]);
    const [lineId] = await seedSaleLines(saleId, [
      { productId: prodId!, productName: 'TT Product', qty: 1, unitPriceCents: 200 },
    ]);
    await seedStock(ctx, prodId!, 10);

    const splitRes = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Terminal Box', lines: [{ sale_line_id: lineId, qty: 1 }] }],
      }),
    );
    const { fulfillment_ids: [fulfillmentId] } = await splitRes.json();

    for (const to of ['picked', 'packed', 'shipped', 'fulfilled'] as const) {
      const r = await fulfillmentAdvanceHandler(
        makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to }),
      );
      expect(r.status).toBe(200);
    }

    // Try to advance from terminal
    const res = await fulfillmentAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to: 'shipped' }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('illegal_transition');
  });

  it('cancelled → picked (cancelled is terminal) → 409 illegal_transition', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1000 });
    const [prodId] = await seedProducts(ctx.clientId, [
      { name: `Cancelled Terminal ${Math.random().toString(36).slice(2)}`, price_cents: 200 },
    ]);
    const [lineId] = await seedSaleLines(saleId, [
      { productId: prodId!, productName: 'CT Product', qty: 1, unitPriceCents: 200 },
    ]);

    const splitRes = await splitHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/split/${saleId}`, {
        fulfillments: [{ label: 'Cancel Box', lines: [{ sale_line_id: lineId, qty: 1 }] }],
      }),
    );
    expect(splitRes.status).toBe(201);
    const { fulfillment_ids: [fulfillmentId] } = await splitRes.json();

    // Advance pending → cancelled
    const cancelRes = await fulfillmentAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to: 'cancelled' }),
    );
    expect(cancelRes.status).toBe(200);
    expect((await cancelRes.json()).status).toBe('cancelled');

    // Attempt any further advance from the terminal cancelled state → 409
    const res = await fulfillmentAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/fulfillment-advance/${fulfillmentId}`, { to: 'picked' }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('illegal_transition');
  });

  it('bad uuid → 404', async () => {
    const ctx = await seedOrdersClient();
    const res = await fulfillmentAdvanceHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/fulfillment-advance/not-a-uuid', { to: 'picked' }),
    );
    expect(res.status).toBe(404);
  });
});

describe('orders merge', () => {
  it('POST merge: two paid same-phone sales → 201 group_id + 2 member rows', async () => {
    const ctx = await seedOrdersClient();
    const phone = `+1${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const primaryId = await seedPaidSaleWithPhone(ctx.clientId, ctx.userNodeId, phone, 1000);
    const secondId = await seedPaidSaleWithPhone(ctx.clientId, ctx.userNodeId, phone, 1500);

    const res = await mergeHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/merge', {
        primary_sale_id: primaryId,
        sale_ids: [primaryId, secondId],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.group_id).toBeTruthy();

    // Verify group record
    const groups = (await sql`
      SELECT primary_sale_id, customer_key FROM public.orders_merge_groups
      WHERE id = ${body.group_id}::uuid
    `) as Array<{ primary_sale_id: string; customer_key: string }>;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.primary_sale_id).toBe(primaryId);
    expect(groups[0]!.customer_key).toBe(phone);

    // Verify 2 member rows
    const members = (await sql`
      SELECT sale_id FROM public.orders_merge_members WHERE group_id = ${body.group_id}::uuid
      ORDER BY sale_id
    `) as Array<{ sale_id: string }>;
    expect(members).toHaveLength(2);
    const memberIds = members.map((m) => m.sale_id);
    expect(memberIds).toContain(primaryId);
    expect(memberIds).toContain(secondId);
  });

  it('fulfilled sale in sale_ids → 409 sale_not_open', async () => {
    const ctx = await seedOrdersClient();
    const phone = `+1${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const primaryId = await seedPaidSaleWithPhone(ctx.clientId, ctx.userNodeId, phone, 1000);

    // Insert a fulfilled sale with the same phone
    const orderNo2 = Math.floor(200000 + Math.random() * 800000);
    const rows2 = (await sql`
      INSERT INTO public.sales
        (bucket_id, order_no, status, channel, customer_name, customer_phone,
         subtotal_cents, discount_cents, tax_cents, total_cents, created_by_user_node,
         paid_at, fulfilled_at)
      VALUES
        (${ctx.clientId}::uuid, ${orderNo2}, 'fulfilled'::sale_status, 'instore'::sale_channel,
         'Merge C', ${phone}, 1500, 0, 0, 1500, ${ctx.userNodeId}::uuid, now(), now())
      RETURNING id
    `) as Array<{ id: string }>;
    const fulfilledId = rows2[0]!.id;

    const res = await mergeHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/merge', {
        primary_sale_id: primaryId,
        sale_ids: [primaryId, fulfilledId],
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('sale_not_open');
  });

  it('different phone → 409 customer_mismatch', async () => {
    const ctx = await seedOrdersClient();
    const phone1 = `+1${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const phone2 = `+1${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const primaryId = await seedPaidSaleWithPhone(ctx.clientId, ctx.userNodeId, phone1, 1000);
    const secondId = await seedPaidSaleWithPhone(ctx.clientId, ctx.userNodeId, phone2, 1500);

    const res = await mergeHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/merge', {
        primary_sale_id: primaryId,
        sale_ids: [primaryId, secondId],
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('customer_mismatch');
  });

  it('foreign sale (other client) → 404', async () => {
    const ctx = await seedOrdersClient();
    const otherCtx = await seedOrdersClient();
    const phone = `+1${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const primaryId = await seedPaidSaleWithPhone(ctx.clientId, ctx.userNodeId, phone, 1000);
    // Foreign sale belongs to a different client
    const { saleId: foreignSaleId } = await seedSale(otherCtx, { status: 'paid', total: 500 });

    const res = await mergeHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/merge', {
        primary_sale_id: primaryId,
        sale_ids: [primaryId, foreignSaleId],
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe('orders sale-lines', () => {
  it('GET sale-lines/:saleId on a fresh (never-split) sale → 200 with lines', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 2000 });
    const [prodAId, prodBId] = await seedProducts(ctx.clientId, [
      { name: `SL Product A ${Math.random().toString(36).slice(2)}`, price_cents: 500 },
      { name: `SL Product B ${Math.random().toString(36).slice(2)}`, price_cents: 700 },
    ]);
    await seedSaleLines(saleId, [
      { productId: prodAId!, productName: 'SL A', qty: 3, unitPriceCents: 500 },
      { productId: prodBId!, productName: 'SL B', qty: 2, unitPriceCents: 700 },
    ]);

    const res = await saleLinesHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/sale-lines/${saleId}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sale.id).toBe(saleId);
    expect(typeof body.sale.order_no).toBe('number');
    expect(typeof body.sale.customer_name).toBe('string');
    expect(Array.isArray(body.lines)).toBe(true);
    expect(body.lines).toHaveLength(2);
    // lines ordered by position: first inserted = position 1
    expect(body.lines[0].qty).toBe(3);
    expect(body.lines[0].product_name_snap).toBe('SL A');
    expect(body.lines[1].qty).toBe(2);
  });

  it('foreign/unknown saleId → 404', async () => {
    const ctx = await seedOrdersClient();
    const otherCtx = await seedOrdersClient();
    const { saleId: foreignId } = await seedSale(otherCtx, { status: 'paid', total: 500 });

    const res = await saleLinesHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/sale-lines/${foreignId}`),
    );
    expect(res.status).toBe(404);
  });

  it('bad uuid → 404', async () => {
    const ctx = await seedOrdersClient();
    const res = await saleLinesHandler(
      makeBucketUserRequest(ctx, 'GET', '/api/orders/sale-lines/not-a-uuid'),
    );
    expect(res.status).toBe(404);
  });
});
