import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import byLocationHandler from '../../netlify/functions/inventory-by-location';
import { seedInventoryClient } from './_helpers';
import { seedProducts, makeBucketUserRequest, seedClientWithProductsEnabled } from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);

describe('GET /api/inventory/by-location', () => {
  it('412 when inventory is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    expect((await byLocationHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/by-location'))).status).toBe(412);
  });

  it('returns empty locations when none are set up', async () => {
    const ctx = await seedInventoryClient();
    const res = await byLocationHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/by-location'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locations).toEqual([]);
    expect(body.items).toEqual([]);
  });

  it('returns stock grouped by warehouse location', async () => {
    const ctx = await seedInventoryClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'Widget' }]))[0]!;
    const loc = (await sql`
      INSERT INTO public.warehouse_locations (client_id, name, kind)
      VALUES (${ctx.clientId}, ${`Loc-${randomUUID().slice(0, 8)}`}, 'warehouse') RETURNING id
    `) as Array<{ id: string }>;
    await sql`INSERT INTO public.stock_by_location (location_id, product_id, qty) VALUES (${loc[0]!.id}, ${p}, 25)`;

    const res = await byLocationHandler(makeBucketUserRequest(ctx, 'GET', '/api/inventory/by-location'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locations.length).toBe(1);
    expect(body.items.length).toBe(1);
    expect(body.items[0].qty).toBe(25);
    expect(body.items[0].product_name).toBe('Widget');
  });
});
