import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import returns from '../../netlify/functions/orders-returns';
import advance from '../../netlify/functions/orders-return-advance';
import receiptLink from '../../netlify/functions/orders-return-receipt-link';
import refundRequest from '../../netlify/functions/orders-return-refund-request';
import { makeBucketUserRequest, seedOrdersClient, seedProducts, seedSale } from './_helpers';
const sql = neon(process.env.DATABASE_URL!);
describe('orders return cases', () => {
  it('rejects a non-object request body before reaching the canonical service', async () => {
    const ctx = await seedOrdersClient();
    const response = await returns(makeBucketUserRequest(ctx, 'POST', '/api/orders/returns', null));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_body');
  });

  it('creates a line-scoped request idempotently and authorizes it once', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'fulfilled', channel: 'pickup', total: 200 });
    const [productId] = await seedProducts(ctx.clientId, [
      { name: `Return ${crypto.randomUUID()}`, price_cents: 100 },
    ]);
    const lines =
      (await sql`INSERT INTO public.sale_lines (sale_id,product_id,product_name_snap,unit_price_cents,qty,line_total_cents,position) VALUES (${saleId}::uuid,${productId}::uuid,'Return',100,2,200,1) RETURNING id`) as Array<{
        id: string;
      }>;
    const key = crypto.randomUUID();
    const created = await returns(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/returns', {
        sale_id: saleId,
        idempotency_key: key,
        reason: 'Too small',
        lines: [{ sale_line_id: lines[0]!.id, qty: 1, reason: 'Too small' }],
      }),
    );
    expect(created.status).toBe(201);
    const c = await created.json();
    const retry = await returns(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/returns', {
        sale_id: saleId,
        idempotency_key: key,
        lines: [{ sale_line_id: lines[0]!.id, qty: 1 }],
      }),
    );
    expect(retry.status).toBe(200);
    expect((await retry.json()).id).toBe(c.id);
    const authorized = await advance(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/returns/${c.id}/advance`, {
        to: 'authorized',
      }),
    );
    expect(authorized.status).toBe(200);
    expect((await authorized.json()).status).toBe('authorized');
    const listed = await returns(makeBucketUserRequest(ctx, 'GET', '/api/orders/returns'));
    expect(listed.status).toBe(200);
    const listedCase = (await listed.json()).find((row: { id: string }) => row.id === c.id);
    expect(listedCase).toMatchObject({ status: 'authorized', order_no: expect.any(Number) });
    expect(listedCase.lines[0]).toMatchObject({
      sale_line_id: lines[0]!.id,
      qty: 1,
      inventory_return_id: null,
      refund_id: null,
    });
  });

  it('does not reopen already-returned fulfilled quantity', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'fulfilled', channel: 'pickup', total: 100 });
    const [productId] = await seedProducts(ctx.clientId, [
      { name: `Return ${crypto.randomUUID()}`, price_cents: 100 },
    ]);
    const saleLines =
      (await sql`INSERT INTO public.sale_lines (sale_id,product_id,product_name_snap,unit_price_cents,qty,line_total_cents,position) VALUES (${saleId}::uuid,${productId}::uuid,'Return',100,1,100,1) RETURNING id`) as Array<{
        id: string;
      }>;
    const body = { sale_id: saleId, lines: [{ sale_line_id: saleLines[0]!.id, qty: 1 }] };
    expect(
      (
        await returns(
          makeBucketUserRequest(ctx, 'POST', '/api/orders/returns', {
            ...body,
            idempotency_key: crypto.randomUUID(),
          }),
        )
      ).status,
    ).toBe(201);
    const duplicate = await returns(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/returns', {
        ...body,
        idempotency_key: crypto.randomUUID(),
      }),
    );
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe('return_qty_exceeds_fulfilled');
  });

  it('links the Inventory receipt before creating one idempotent Orders refund intent', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx, { status: 'fulfilled', channel: 'pickup', total: 200 });
    const [productId] = await seedProducts(ctx.clientId, [
      { name: `Return ${crypto.randomUUID()}`, price_cents: 100 },
    ]);
    const saleLines =
      (await sql`INSERT INTO public.sale_lines (sale_id,product_id,product_name_snap,unit_price_cents,qty,line_total_cents,position) VALUES (${saleId}::uuid,${productId}::uuid,'Return',100,2,200,1) RETURNING id`) as Array<{
        id: string;
      }>;
    const created = await returns(
      makeBucketUserRequest(ctx, 'POST', '/api/orders/returns', {
        sale_id: saleId,
        idempotency_key: crypto.randomUUID(),
        lines: [{ sale_line_id: saleLines[0]!.id, qty: 1 }],
      }),
    );
    const returnCase = (await created.json()) as { id: string };
    const returnLines =
      (await sql`SELECT id FROM public.orders_return_case_lines WHERE return_case_id=${returnCase.id}::uuid`) as Array<{
        id: string;
      }>;
    await advance(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/returns/${returnCase.id}/advance`, {
        to: 'authorized',
      }),
    );
    await sql`UPDATE public.orders_return_cases SET status='awaiting_receipt' WHERE id=${returnCase.id}::uuid`;
    const inventoryRows =
      (await sql`INSERT INTO public.inventory_returns (client_id,product_id,qty,disposition,reason,created_by) VALUES (${ctx.clientId}::uuid,${productId}::uuid,1,'restock','received for test',${ctx.userNodeId}::uuid) RETURNING id`) as Array<{
        id: string;
      }>;
    const receipt = await receiptLink(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/returns/${returnCase.id}/receipt-link`, {
        return_line_id: returnLines[0]!.id,
        inventory_return_id: inventoryRows[0]!.id,
      }),
    );
    expect(receipt.status).toBe(200);
    const requested = await refundRequest(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/returns/${returnCase.id}/refund-request`, {
        return_line_id: returnLines[0]!.id,
        reason: 'received',
      }),
    );
    expect(requested.status).toBe(201);
    const refund = await requested.json();
    expect(refund.amount_cents).toBe(100);
    expect(refund.state).toBe('requested');
    const retry = await refundRequest(
      makeBucketUserRequest(ctx, 'POST', `/api/orders/returns/${returnCase.id}/refund-request`, {
        return_line_id: returnLines[0]!.id,
      }),
    );
    expect(retry.status).toBe(200);
    expect((await retry.json()).id).toBe(refund.id);
  });
});
