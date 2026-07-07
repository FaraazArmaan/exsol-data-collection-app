// tests/orders/shipments.test.ts — Shipment Tracking (Task 2)
import { describe, it, expect } from 'vitest';
import { seedOrdersClient, seedSale, makeBucketUserRequest } from './_helpers';
import shipmentsHandler from '../../netlify/functions/orders-shipments';
import shipmentDetailHandler from '../../netlify/functions/orders-shipment-detail';

describe('orders shipments', () => {
  it('POST create shipment → 201, status=pending', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 2000 });

    const res = await shipmentsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/shipments', {
        sale_id: saleId,
        carrier: 'FedEx',
        tracking_ref: 'FX12345',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.status).toBe('pending');
  });

  it('GET list shipments → 200 array', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1500 });

    await shipmentsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/shipments', { sale_id: saleId }),
    );

    const res = await shipmentsHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/shipments'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((s: { sale_id: string }) => s.sale_id === saleId);
    expect(found).toBeDefined();
  });

  it('PUT to shipped stamps shipped_at', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1500 });

    const r = await shipmentsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/shipments', { sale_id: saleId }),
    );
    const { id } = await r.json();

    const r2 = await shipmentDetailHandler(
      makeBucketUserRequest(ctx, 'PUT', `/api/orders/shipment-detail/${id}`, { status: 'shipped' }),
    );
    expect(r2.status).toBe(200);
    const body2 = await r2.json();
    expect(body2.status).toBe('shipped');
    expect(body2.shipped_at).toBeTruthy();
  });

  it('PUT to delivered stamps delivered_at', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'fulfilled', total: 2500 });

    const r = await shipmentsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/shipments', { sale_id: saleId }),
    );
    const { id } = await r.json();

    // Ship first
    await shipmentDetailHandler(
      makeBucketUserRequest(ctx, 'PUT', `/api/orders/shipment-detail/${id}`, { status: 'shipped' }),
    );

    // Deliver
    const r3 = await shipmentDetailHandler(
      makeBucketUserRequest(ctx, 'PUT', `/api/orders/shipment-detail/${id}`, { status: 'delivered' }),
    );
    expect(r3.status).toBe(200);
    const body3 = await r3.json();
    expect(body3.status).toBe('delivered');
    expect(body3.delivered_at).toBeTruthy();
  });

  it('shipment-detail GET → 200 with shipment data', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1000 });

    const r = await shipmentsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/shipments', {
        sale_id: saleId,
        carrier: 'DHL',
        tracking_ref: 'DH99999',
      }),
    );
    const { id } = await r.json();

    const res = await shipmentDetailHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/orders/shipment-detail/${id}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.carrier).toBe('DHL');
  });

  it('PUT invalid status → 400 invalid_status', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1000 });

    const r = await shipmentsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/shipments', { sale_id: saleId }),
    );
    const { id } = await r.json();

    const res = await shipmentDetailHandler(
      makeBucketUserRequest(ctx, 'PUT', `/api/orders/shipment-detail/${id}`, {
        status: 'flying',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_status');
  });

  it('PUT delivered then PUT pending → 400 illegal_shipment_transition', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 1000 });

    const r = await shipmentsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/shipments', { sale_id: saleId }),
    );
    const { id } = await r.json();

    // pending → shipped
    await shipmentDetailHandler(
      makeBucketUserRequest(ctx, 'PUT', `/api/orders/shipment-detail/${id}`, { status: 'shipped' }),
    );
    // shipped → delivered
    await shipmentDetailHandler(
      makeBucketUserRequest(ctx, 'PUT', `/api/orders/shipment-detail/${id}`, { status: 'delivered' }),
    );
    // delivered → pending (illegal backward transition)
    const bad = await shipmentDetailHandler(
      makeBucketUserRequest(ctx, 'PUT', `/api/orders/shipment-detail/${id}`, { status: 'pending' }),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('illegal_shipment_transition');
  });

  it('legal pending→shipped→delivered path → 200 with stamps', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'paid', total: 2000 });

    const r = await shipmentsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/shipments', { sale_id: saleId }),
    );
    expect(r.status).toBe(201);
    const { id } = await r.json();

    const r2 = await shipmentDetailHandler(
      makeBucketUserRequest(ctx, 'PUT', `/api/orders/shipment-detail/${id}`, { status: 'shipped' }),
    );
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.status).toBe('shipped');
    expect(b2.shipped_at).toBeTruthy();

    const r3 = await shipmentDetailHandler(
      makeBucketUserRequest(ctx, 'PUT', `/api/orders/shipment-detail/${id}`, { status: 'delivered' }),
    );
    expect(r3.status).toBe(200);
    const b3 = await r3.json();
    expect(b3.status).toBe('delivered');
    expect(b3.delivered_at).toBeTruthy();
  });

  it('foreign id → 404', async () => {
    const ctx = await seedOrdersClient();
    const fakeId = '00000000-0000-0000-0000-000000000002';

    const res = await shipmentDetailHandler(
      makeBucketUserRequest(ctx, 'PUT', `/api/orders/shipment-detail/${fakeId}`, {
        status: 'shipped',
      }),
    );
    expect(res.status).toBe(404);
  });
});
