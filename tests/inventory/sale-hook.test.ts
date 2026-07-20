import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import createHandler from '../../netlify/functions/pos-sale-create';
import stateHandler from '../../netlify/functions/pos-sale-state';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';
import {
  seedInventoryClient, seedStock, setTrackingFlag, readStock, readMovements,
} from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

// Create an instore sale for `qty` of `productId`, then markPaid — which for an
// instore sale auto-fulfills, firing the inventory decrement hook.
async function saleFulfilled(
  ctx: Awaited<ReturnType<typeof seedInventoryClient>>,
  productId: string,
  qty: number,
): Promise<string> {
  const created = await createHandler(
    makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'instore',
      idempotencyKey: crypto.randomUUID(),
      customer: { name: 'A', phone: '1' },
      lines: [{ productId, qty }],
    }),
  );
  const sid = (await created.json()).id as string;
  const res = await stateHandler(
    makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
      action: 'markPaid', paymentMethod: 'cash',
    }),
  );
  expect(res.status).toBe(200);
  expect((await res.json()).status).toBe('fulfilled');
  return sid;
}

describe('POS sale completion → inventory decrement hook', () => {
  it('reserves at checkout, then consumes stock and writes a sale movement on fulfillment', async () => {
    const ctx = await seedInventoryClient();
    await setTrackingFlag(ctx, true);
    const p = (await seedProducts(ctx.clientId, [{ name: 'Tracked', sale_price_cents: 100 }]))[0]!;
    await seedStock(ctx, p, 10);

    const created = await createHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
        channel: 'instore', idempotencyKey: crypto.randomUUID(),
        customer: { name: 'A', phone: '1' }, lines: [{ productId: p, qty: 3 }],
      }),
    );
    expect(created.status).toBe(201);
    const sid = (await created.json()).id as string;
    expect(await readStock(ctx, p)).toMatchObject({ qty_on_hand: 10, qty_reserved: 3 });

    const fulfilled = await stateHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
        action: 'markPaid', paymentMethod: 'cash',
      }),
    );
    expect(fulfilled.status).toBe(200);

    expect(await readStock(ctx, p)).toMatchObject({ qty_on_hand: 7, qty_reserved: 0 });
    const mv = await readMovements(ctx, p);
    expect(mv[0]!.type).toBe('sale');
    expect(mv[0]!.qty_delta).toBe(-3);
    expect(mv[0]!.ref).toBe(`sale:${sid}`);
  });

  it('releases a pending order reservation on cancellation', async () => {
    const ctx = await seedInventoryClient();
    await setTrackingFlag(ctx, true);
    const p = (await seedProducts(ctx.clientId, [{ name: 'Cancelled', sale_price_cents: 100 }]))[0]!;
    await seedStock(ctx, p, 4);
    const created = await createHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'pickup', idempotencyKey: crypto.randomUUID(),
      customer: { name: 'A', phone: '1' }, lines: [{ productId: p, qty: 2 }],
    }));
    const sid = (await created.json()).id as string;
    expect((await readStock(ctx, p))?.qty_reserved).toBe(2);

    const cancelled = await stateHandler(makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`, {
      action: 'cancel', reason: 'customer changed mind',
    }));
    expect(cancelled.status).toBe(200);
    expect(await readStock(ctx, p)).toMatchObject({ qty_on_hand: 4, qty_reserved: 0 });
    const reservations = await sql`
      SELECT status FROM public.inventory_reservations WHERE sale_id = ${sid}::uuid
    ` as Array<{ status: string }>;
    expect(reservations[0]?.status).toBe('released');
  });

  it('refuses a checkout that exceeds tracked, unreserved stock', async () => {
    const ctx = await seedInventoryClient();
    await setTrackingFlag(ctx, true);
    const p = (await seedProducts(ctx.clientId, [{ name: 'Too few', sale_price_cents: 100 }]))[0]!;
    await seedStock(ctx, p, 1);
    const res = await createHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'pickup', idempotencyKey: crypto.randomUUID(),
      customer: { name: 'A', phone: '1' }, lines: [{ productId: p, qty: 2 }],
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'insufficient_stock' } });
    expect(await readStock(ctx, p)).toMatchObject({ qty_on_hand: 1, qty_reserved: 0 });
  });

  it('reserves the selected variant stock row, not the parent product row', async () => {
    const ctx = await seedInventoryClient();
    await setTrackingFlag(ctx, true);
    const p = (await seedProducts(ctx.clientId, [{ name: 'Variant tracked', sale_price_cents: 100 }]))[0]!;
    const variant = await sql`
      INSERT INTO public.product_variants (client_id, product_id, title, option_values, status)
      VALUES (${ctx.clientId}::uuid, ${p}::uuid, 'Medium', '{"size":"M"}'::jsonb, 'active')
      RETURNING id
    ` as Array<{ id: string }>;
    await sql`
      INSERT INTO public.inventory_stock (client_id, product_id, variant_id, qty_on_hand)
      VALUES (${ctx.clientId}::uuid, ${p}::uuid, ${variant[0]!.id}::uuid, 3)
    `;
    const created = await createHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'pickup', idempotencyKey: crypto.randomUUID(),
      customer: { name: 'A', phone: '1' }, lines: [{ productId: p, variantId: variant[0]!.id, qty: 2 }],
    }));
    expect(created.status).toBe(201);
    const stock = await sql`
      SELECT qty_on_hand, qty_reserved FROM public.inventory_stock
      WHERE client_id = ${ctx.clientId}::uuid AND variant_id = ${variant[0]!.id}::uuid
    ` as Array<{ qty_on_hand: number; qty_reserved: number }>;
    expect(stock[0]).toMatchObject({ qty_on_hand: 3, qty_reserved: 2 });
  });

  it('leaves stock untouched when tracking is OFF (legacy tenants unaffected)', async () => {
    const ctx = await seedInventoryClient();
    await setTrackingFlag(ctx, false);
    const p = (await seedProducts(ctx.clientId, [{ name: 'Untracked', sale_price_cents: 100 }]))[0]!;
    await seedStock(ctx, p, 10);

    await saleFulfilled(ctx, p, 4);

    expect((await readStock(ctx, p))?.qty_on_hand).toBe(10);
    expect((await readMovements(ctx, p)).length).toBe(0);
  });
});
