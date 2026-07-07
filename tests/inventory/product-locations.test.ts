import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import handler from '../../netlify/functions/inventory-product-locations';
import { seedInventoryClient, seedStock } from './_helpers';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);

describe('GET /api/inventory/product-locations', () => {
  it('400 without product_id', async () => {
    const ctx = await seedInventoryClient();
    expect((await handler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/product-locations'))).status).toBe(400);
  });

  it('returns on-hand + per-location breakdown', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'Widget' }]))[0]!;
    await seedStock(ctx, p, 20, 5);
    const loc = (await sql`
      INSERT INTO public.warehouse_locations (client_id, name, kind)
      VALUES (${ctx.clientId}, ${`Loc-${randomUUID().slice(0, 8)}`}, 'store') RETURNING id
    `) as Array<{ id: string }>;
    await sql`INSERT INTO public.stock_by_location (location_id, product_id, qty) VALUES (${loc[0]!.id}, ${p}, 12)`;

    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/inventory/product-locations?product_id=${p}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.on_hand).toBe(20);
    expect(body.location_total).toBe(12);
    expect(body.by_location.length).toBe(1);
    expect(body.by_location[0].qty).toBe(12);
  });

  it('returns zeros for a product with no location placement', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'Nowhere' }]))[0]!;
    await seedStock(ctx, p, 7, 5);
    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/inventory/product-locations?product_id=${p}`));
    const body = await res.json();
    expect(body.on_hand).toBe(7);
    expect(body.location_total).toBe(0);
    expect(body.by_location).toEqual([]);
  });
});
