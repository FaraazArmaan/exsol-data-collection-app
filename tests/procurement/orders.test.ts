import { describe, it, expect } from 'vitest';
import ordersHandler from '../../netlify/functions/procurement-orders';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';
import { seedProcurementClient, seedSupplier } from './_helpers';

describe('purchase orders — create + list', () => {
  it('400 supplier_required when no supplier', async () => {
    const ctx = await seedProcurementClient();
    const res = await ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/orders', { items: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('supplier_required');
  });

  it('400 items_required when no items', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const res = await ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/orders', { supplier_id: sup, items: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('items_required');
  });

  it('404 supplier_not_found for an unknown supplier', async () => {
    const ctx = await seedProcurementClient();
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const res = await ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/orders', {
      supplier_id: '00000000-0000-0000-0000-000000000000',
      items: [{ product_id: p, qty: 1, unit_cost_cents: 100 }],
    }));
    expect(res.status).toBe(404);
  });

  it('creates a PO and lists it with an item count', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const p = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const c = await ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/orders', {
      supplier_id: sup, items: [{ product_id: p, qty: 4, unit_cost_cents: 250 }],
    }));
    expect(c.status).toBe(201);
    const list = await ordersHandler(makeBucketUserRequest(ctx, 'GET', '/api/procurement/orders'));
    const body = await list.json();
    expect(body.orders.length).toBe(1);
    expect(body.orders[0].item_count).toBe(1);
    expect(body.orders[0].status).toBe('draft');
  });

  it('400 invalid_item_product for a product owned by another client', async () => {
    const ctx = await seedProcurementClient();
    const other = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const foreign = (await seedProducts(other.clientId, [{ name: 'F' }]))[0]!;
    const res = await ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/orders', {
      supplier_id: sup, items: [{ product_id: foreign, qty: 1, unit_cost_cents: 100 }],
    }));
    expect(res.status).toBe(400);
  });
});
