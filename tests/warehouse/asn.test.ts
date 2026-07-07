import { describe, it, expect } from 'vitest';
import asnHandler from '../../netlify/functions/warehouse-asn';
import asnDetailHandler from '../../netlify/functions/warehouse-asn-detail';
import asnReceiveHandler from '../../netlify/functions/warehouse-asn-receive';
import { makeBucketUserRequest, seedProducts, seedClientWithProductsEnabled, seedSubordinateUser } from '../pos/_helpers';
import { seedWarehouseClient, seedReceivedPO, randName } from './_helpers';

type Ctx = Awaited<ReturnType<typeof seedWarehouseClient>>;
const listAsn = (ctx: Ctx, qs = '') => asnHandler(makeBucketUserRequest(ctx, 'GET', `/api/warehouse/asn${qs}`));
const createAsn = (ctx: Ctx, body: unknown) => asnHandler(makeBucketUserRequest(ctx, 'POST', '/api/warehouse/asn', body));
const detailAsn = (ctx: Ctx, id: string) => asnDetailHandler(makeBucketUserRequest(ctx, 'GET', `/api/warehouse/asn-detail/${id}`));
const receiveAsn = (ctx: Ctx, body: unknown) => asnReceiveHandler(makeBucketUserRequest(ctx, 'POST', '/api/warehouse/asn-receive', body));

describe('warehouse ASN', () => {
  it('creates an ASN with explicit lines and lists it', async () => {
    const ctx = await seedWarehouseClient();
    const [p1, p2] = await seedProducts(ctx.clientId, [{ name: randName('P') }, { name: randName('P') }]);
    const res = await createAsn(ctx, {
      reference: randName('ASN'),
      carrier: 'DHL',
      lines: [{ product_id: p1, expected_qty: 10 }, { product_id: p2, expected_qty: 5 }],
    });
    expect(res.status).toBe(201);
    const asn = (await res.json()).asn;
    expect(asn.status).toBe('pending');

    const listed = (await (await listAsn(ctx)).json()).asns as Array<{ id: string; total_expected: number; line_count: number }>;
    const row = listed.find((a) => a.id === asn.id);
    expect(row?.total_expected).toBe(15);
    expect(row?.line_count).toBe(2);
  });

  it('pre-fills lines from a linked purchase order when none are given', async () => {
    const ctx = await seedWarehouseClient();
    const [p1, p2] = await seedProducts(ctx.clientId, [{ name: randName('P') }, { name: randName('P') }]);
    const { poId } = await seedReceivedPO(ctx, [{ productId: p1!, qty: 7 }, { productId: p2!, qty: 2 }], 'ordered');
    const res = await createAsn(ctx, { reference: randName('ASN'), purchase_order_id: poId });
    expect(res.status).toBe(201);
    const asnId = (await res.json()).asn.id;
    const lines = (await (await detailAsn(ctx, asnId)).json()).lines as Array<{ product_id: string; expected_qty: number }>;
    expect(lines).toHaveLength(2);
    expect(lines.reduce((s, l) => s + l.expected_qty, 0)).toBe(9);
  });

  it('400 reference_required when reference is blank', async () => {
    const ctx = await seedWarehouseClient();
    const [p1] = await seedProducts(ctx.clientId, [{ name: randName('P') }]);
    const res = await createAsn(ctx, { reference: '  ', lines: [{ product_id: p1, expected_qty: 1 }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('reference_required');
  });

  it('400 lines_required when neither PO nor lines are supplied', async () => {
    const ctx = await seedWarehouseClient();
    const res = await createAsn(ctx, { reference: randName('ASN') });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('lines_required');
  });

  it('404 product_not_found for a foreign-client product line', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const [foreign] = await seedProducts(other.clientId, [{ name: randName('P') }]);
    const res = await createAsn(ctx, { reference: randName('ASN'), lines: [{ product_id: foreign, expected_qty: 3 }] });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('product_not_found');
  });

  it('records receipt: received_qty + status, variance visible in detail', async () => {
    const ctx = await seedWarehouseClient();
    const [p1] = await seedProducts(ctx.clientId, [{ name: randName('P') }]);
    const asnId = (await (await createAsn(ctx, {
      reference: randName('ASN'), lines: [{ product_id: p1, expected_qty: 10 }],
    })).json()).asn.id;
    const lineId = ((await (await detailAsn(ctx, asnId)).json()).lines as Array<{ id: string }>)[0]!.id;

    const res = await receiveAsn(ctx, { asn_id: asnId, lines: [{ line_id: lineId, received_qty: 8 }] });
    expect(res.status).toBe(200);

    const detail = await (await detailAsn(ctx, asnId)).json();
    expect(detail.asn.status).toBe('received');
    expect(detail.lines[0].received_qty).toBe(8);
    expect(detail.lines[0].variance).toBe(-2);
  });

  it('404 on receive of a foreign-client ASN', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const [p1] = await seedProducts(other.clientId, [{ name: randName('P') }]);
    const foreignAsn = (await (await createAsn(other, {
      reference: randName('ASN'), lines: [{ product_id: p1, expected_qty: 3 }],
    })).json()).asn.id;
    const res = await receiveAsn(ctx, { asn_id: foreignAsn, lines: [] });
    expect(res.status).toBe(404);
  });

  it('404 detail for a foreign-client ASN', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const [p1] = await seedProducts(other.clientId, [{ name: randName('P') }]);
    const foreignAsn = (await (await createAsn(other, {
      reference: randName('ASN'), lines: [{ product_id: p1, expected_qty: 3 }],
    })).json()).asn.id;
    const res = await detailAsn(ctx, foreignAsn);
    expect(res.status).toBe(404);
  });

  it('412 when warehouse not enabled', async () => {
    const bare = await seedClientWithProductsEnabled();
    const res = await listAsn(bare);
    expect(res.status).toBe(412);
  });

  // Perm contract for ASN create — the L1 Owner all-on set must include
  // warehouse.products.create (regression for the Owner-blanked gap).
  it('L1 Owner can create an ASN without an explicit grant (owner bypass)', async () => {
    const ctx = await seedWarehouseClient(); // seed = L1 Owner
    const [p1] = await seedProducts(ctx.clientId, [{ name: randName('P') }]);
    const res = await createAsn(ctx, { reference: randName('ASN'), lines: [{ product_id: p1, expected_qty: 3 }] });
    expect(res.status).toBe(201);
  });

  it('403 for an L2 lacking warehouse.products.create', async () => {
    const ctx = await seedWarehouseClient();
    const [p1] = await seedProducts(ctx.clientId, [{ name: randName('P') }]);
    const viewer = await seedSubordinateUser(ctx, 2, ['warehouse.products.view']);
    const res = await createAsn(viewer, { reference: randName('ASN'), lines: [{ product_id: p1, expected_qty: 3 }] });
    expect(res.status).toBe(403);
  });

  it('201 for an L2 granted warehouse.products.create', async () => {
    const ctx = await seedWarehouseClient();
    const [p1] = await seedProducts(ctx.clientId, [{ name: randName('P') }]);
    const creator = await seedSubordinateUser(ctx, 2, ['warehouse.products.create']);
    const res = await createAsn(creator, { reference: randName('ASN'), lines: [{ product_id: p1, expected_qty: 3 }] });
    expect(res.status).toBe(201);
  });
});
