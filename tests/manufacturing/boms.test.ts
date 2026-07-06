// tests/manufacturing/boms.test.ts
import { describe, it, expect } from 'vitest';
import bomsHandler from '../../netlify/functions/manufacturing-boms';
import bomDetailHandler from '../../netlify/functions/manufacturing-bom-detail';
import { seedProducts, seedClientWithProductsEnabled, makeBucketUserRequest } from '../pos/_helpers';
import { seedManufacturingClient, seedOrder } from './_helpers';

const create = (ctx: any, body: unknown) =>
  bomsHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/boms', body));
const list = (ctx: any) => bomsHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/boms'));
const detail = (ctx: any, id: string) =>
  bomDetailHandler(makeBucketUserRequest(ctx, 'GET', `/api/manufacturing/bom-detail/${id}`));
const put = (ctx: any, id: string, body: unknown) =>
  bomDetailHandler(makeBucketUserRequest(ctx, 'PUT', `/api/manufacturing/bom-detail/${id}`, body));
const del = (ctx: any, id: string) =>
  bomDetailHandler(makeBucketUserRequest(ctx, 'DELETE', `/api/manufacturing/bom-detail/${id}`));

describe('manufacturing BOMs', () => {
  it('creates a BOM with components and lists it', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1, c2] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }, { name: 'Comb' }]);
    const res = await create(ctx, {
      name: `Kit BOM ${Math.random().toString(36).slice(2, 7)}`,
      output_product_id: out,
      components: [{ product_id: c1, qty: 2 }, { product_id: c2, qty: 1 }],
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const listed = await (await list(ctx)).json();
    const row = listed.items.find((i: any) => i.id === id);
    expect(row.component_count).toBe(2);
    expect(row.output_product_name).toBe('Kit');

    const d = await (await detail(ctx, id)).json();
    expect(d.components).toHaveLength(2);
  });

  it('400 components_required when empty', async () => {
    const ctx = await seedManufacturingClient();
    const [out] = await seedProducts(ctx.clientId, [{ name: 'Kit' }]);
    const res = await create(ctx, { name: 'x', output_product_id: out, components: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('components_required');
  });

  it('404 when a component belongs to another client', async () => {
    const ctx = await seedManufacturingClient();
    const [out] = await seedProducts(ctx.clientId, [{ name: 'Kit' }]);
    const other = await seedClientWithProductsEnabled();
    const [foreign] = await seedProducts(other.clientId, [{ name: 'Foreign' }]);
    const res = await create(ctx, { name: 'x', output_product_id: out, components: [{ product_id: foreign, qty: 1 }] });
    expect(res.status).toBe(404);
  });

  it('deletes an unused BOM', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Kit' }, { name: 'Oil' }]);
    const { id } = await (await create(ctx, { name: 'y', output_product_id: out, components: [{ product_id: c1, qty: 1 }] })).json();
    const res = await del(ctx, id);
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
  });

  it('400 duplicate_component on POST — no orphan BOM left behind', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Widget' }, { name: 'Bolt' }]);
    const uniqueName = `DupBOM-${Math.random().toString(36).slice(2, 9)}`;
    const res = await create(ctx, {
      name: uniqueName,
      output_product_id: out,
      components: [
        { product_id: c1, qty: 1 },
        { product_id: c1, qty: 2 }, // duplicate
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('duplicate_component');
    // Verify no phantom BOM was persisted
    const listed = await (await list(ctx)).json();
    const phantom = listed.items.find((i: any) => i.name === uniqueName);
    expect(phantom).toBeUndefined();
  });

  it('PUT round-trip — name and components updated', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1, c2] = await seedProducts(ctx.clientId, [
      { name: 'Gadget' }, { name: 'Screw' }, { name: 'Nut' },
    ]);
    const origName = `RTPut-${Math.random().toString(36).slice(2, 7)}`;
    const { id } = await (await create(ctx, {
      name: origName,
      output_product_id: out,
      components: [{ product_id: c1, qty: 3 }],
    })).json();

    const newName = `RTPut-Updated-${Math.random().toString(36).slice(2, 7)}`;
    const putRes = await put(ctx, id, {
      name: newName,
      components: [{ product_id: c2, qty: 5 }],
    });
    expect(putRes.status).toBe(200);

    const d = await (await detail(ctx, id)).json();
    expect(d.name).toBe(newName);
    expect(d.components).toHaveLength(1);
    expect(d.components[0].component_product_id).toBe(c2);
    expect(d.components[0].qty).toBe(5);
  });

  it('404 on POST with malformed output_product_id UUID (no 500)', async () => {
    const ctx = await seedManufacturingClient();
    const [c1] = await seedProducts(ctx.clientId, [{ name: 'Comp' }]);
    const res = await create(ctx, {
      name: 'BadOut',
      output_product_id: 'not-a-uuid',
      components: [{ product_id: c1, qty: 1 }],
    });
    expect(res.status).toBe(404);
  });

  it('404 on POST with malformed component product_id UUID (no 500)', async () => {
    const ctx = await seedManufacturingClient();
    const [out] = await seedProducts(ctx.clientId, [{ name: 'Output' }]);
    const res = await create(ctx, {
      name: 'BadComp',
      output_product_id: out,
      components: [{ product_id: 'not-a-uuid', qty: 1 }],
    });
    expect(res.status).toBe(404);
  });

  it('409 bom_in_use when production order references the BOM', async () => {
    const ctx = await seedManufacturingClient();
    const [out, c1] = await seedProducts(ctx.clientId, [{ name: 'Frame' }, { name: 'Arm' }]);
    const { id: bomId } = await (await create(ctx, {
      name: `InUseBOM-${Math.random().toString(36).slice(2, 7)}`,
      output_product_id: out,
      components: [{ product_id: c1, qty: 1 }],
    })).json();
    await seedOrder(ctx, bomId, 10);
    const res = await del(ctx, bomId);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('bom_in_use');
  });
});
