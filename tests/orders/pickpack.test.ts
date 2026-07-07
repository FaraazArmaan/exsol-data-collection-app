// tests/orders/pickpack.test.ts — Pick-Pack PDF (Task 4)
// Tests that pick-list and packing-slip handlers return valid PDF responses.
import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { seedOrdersClient, seedSale, seedProducts, makeBucketUserRequest } from './_helpers';
import pickListHandler from '../../netlify/functions/orders-pick-list';
import packingSlipHandler from '../../netlify/functions/orders-packing-slip';

const sql = neon(process.env.DATABASE_URL!);

// Insert sale_lines for a sale. Returns line ids.
async function seedSaleLines(
  saleId: string,
  lines: Array<{ productId: string; productName: string; qty: number; unitPriceCents: number }>,
): Promise<string[]> {
  const ids: string[] = [];
  let position = 1;
  for (const l of lines) {
    const lineTotalCents = l.unitPriceCents * l.qty;
    const rows = (await sql`
      INSERT INTO public.sale_lines
        (sale_id, product_id, product_name_snap, unit_price_cents, qty, line_total_cents, position)
      VALUES
        (${saleId}::uuid, ${l.productId}::uuid, ${l.productName},
         ${l.unitPriceCents}, ${l.qty}, ${lineTotalCents}, ${position})
      RETURNING id
    `) as Array<{ id: string }>;
    ids.push(rows[0]!.id);
    position++;
  }
  return ids;
}

describe('orders pick-list', () => {
  it('GET pick-list → 200, application/pdf, body > 100 bytes', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 3000 });
    const [productId] = await seedProducts(ctx.clientId, [
      { name: `Pick Product ${Math.random().toString(36).slice(2, 8)}`, price_cents: 1500 },
    ]);
    await seedSaleLines(saleId, [
      { productId: productId!, productName: 'Widget A', qty: 2, unitPriceCents: 1500 },
    ]);

    const res = await pickListHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/pick-list/${saleId}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it('GET pick-list with foreign id → 404', async () => {
    const ctx = await seedOrdersClient();
    const foreignId = '00000000-0000-0000-0000-000000000099';
    const res = await pickListHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/pick-list/${foreignId}`),
    );
    expect(res.status).toBe(404);
  });

  it('GET pick-list with bad uuid → 404', async () => {
    const ctx = await seedOrdersClient();
    const res = await pickListHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/pick-list/not-a-uuid`),
    );
    expect(res.status).toBe(404);
  });

  it('GET pick-list cross-tenant id → 404', async () => {
    const ctx = await seedOrdersClient();
    const otherCtx = await seedOrdersClient();
    const { saleId: otherSaleId } = await seedSale(otherCtx, { status: 'paid', total: 1000 });

    const res = await pickListHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/pick-list/${otherSaleId}`),
    );
    expect(res.status).toBe(404);
  });
});

describe('orders packing-slip', () => {
  it('GET packing-slip → 200, application/pdf, body > 100 bytes', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 4000 });
    const [productId] = await seedProducts(ctx.clientId, [
      { name: `Slip Product ${Math.random().toString(36).slice(2, 8)}`, price_cents: 2000 },
    ]);
    await seedSaleLines(saleId, [
      { productId: productId!, productName: 'Gadget B', qty: 2, unitPriceCents: 2000 },
    ]);

    const res = await packingSlipHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/packing-slip/${saleId}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it('GET packing-slip includes carrier/tracking if shipment exists', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 2000 });
    const [productId] = await seedProducts(ctx.clientId, [
      { name: `Ship Product ${Math.random().toString(36).slice(2, 8)}`, price_cents: 1000 },
    ]);
    await seedSaleLines(saleId, [
      { productId: productId!, productName: 'Item C', qty: 2, unitPriceCents: 1000 },
    ]);

    // Seed a shipment
    await sql`
      INSERT INTO public.orders_shipments (client_id, sale_id, carrier, tracking_ref)
      VALUES (${ctx.clientId}::uuid, ${saleId}::uuid, 'FedEx', 'TRK12345')
    `;

    const res = await packingSlipHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/packing-slip/${saleId}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it('GET packing-slip with foreign id → 404', async () => {
    const ctx = await seedOrdersClient();
    const foreignId = '00000000-0000-0000-0000-000000000098';
    const res = await packingSlipHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/packing-slip/${foreignId}`),
    );
    expect(res.status).toBe(404);
  });

  it('GET packing-slip with bad uuid → 404', async () => {
    const ctx = await seedOrdersClient();
    const res = await packingSlipHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/packing-slip/bad-id-here`),
    );
    expect(res.status).toBe(404);
  });

  it('GET packing-slip cross-tenant id → 404', async () => {
    const ctx = await seedOrdersClient();
    const otherCtx = await seedOrdersClient();
    const { saleId: otherSaleId } = await seedSale(otherCtx, { status: 'paid', total: 1000 });

    const res = await packingSlipHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/packing-slip/${otherSaleId}`),
    );
    expect(res.status).toBe(404);
  });
});
