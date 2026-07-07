import { describe, it, expect } from 'vitest';
import generateHandler from '../../netlify/functions/warehouse-ai-slotting-generate';
import listHandler from '../../netlify/functions/warehouse-ai-slotting';
import decideHandler from '../../netlify/functions/warehouse-ai-slotting-decide';
import { makeBucketUserRequest, seedProducts, seedClientWithProductsEnabled } from '../pos/_helpers';
import { seedWarehouseClient, seedLocation, seedStockAt, readStockAt, randName } from './_helpers';

type Ctx = Awaited<ReturnType<typeof seedWarehouseClient>>;
const generate = (ctx: Ctx) => generateHandler(makeBucketUserRequest(ctx, 'POST', '/api/warehouse/ai-slotting-generate', {}));
const list = (ctx: Ctx, qs = '') => listHandler(makeBucketUserRequest(ctx, 'GET', `/api/warehouse/ai-slotting${qs}`));
const decide = (ctx: Ctx, body: unknown) => decideHandler(makeBucketUserRequest(ctx, 'POST', '/api/warehouse/ai-slotting-decide', body));

async function seedSlottingScenario(ctx: Ctx) {
  const [p1] = await seedProducts(ctx.clientId, [{ name: randName('Fast') }]);
  const storage = await seedLocation(ctx, randName('Storage'), 'storage');
  const store = await seedLocation(ctx, randName('Store'), 'store');
  await seedStockAt(storage, p1!, 10);
  return { p1: p1!, storage, store };
}

describe('warehouse AI slotting', () => {
  it('generates pending suggestions from stock sitting away from a store location', async () => {
    const ctx = await seedWarehouseClient();
    const { p1, storage, store } = await seedSlottingScenario(ctx);

    const res = await generate(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBeGreaterThanOrEqual(1);
    // keyless in tests → the AI fell back to the deterministic preview
    expect(body.ai_fallback).toBe(true);

    const items = (await (await list(ctx, '?status=pending')).json()).suggestions as Array<{
      product_id: string; from_location_id: string; to_location_id: string; suggested_qty: number; rationale: string;
    }>;
    const s = items.find((x) => x.product_id === p1);
    expect(s).toBeTruthy();
    expect(s!.from_location_id).toBe(storage);
    expect(s!.to_location_id).toBe(store);
    expect(s!.suggested_qty).toBeGreaterThan(0);
    expect(s!.rationale.length).toBeGreaterThan(0);
  });

  it('regenerating replaces the pending set (no duplicates)', async () => {
    const ctx = await seedWarehouseClient();
    await seedSlottingScenario(ctx);
    await generate(ctx);
    const first = ((await (await list(ctx, '?status=pending')).json()).suggestions as unknown[]).length;
    await generate(ctx);
    const second = ((await (await list(ctx, '?status=pending')).json()).suggestions as unknown[]).length;
    expect(second).toBe(first);
  });

  it('created 0 when there is no store location to slot into', async () => {
    const ctx = await seedWarehouseClient();
    const [p1] = await seedProducts(ctx.clientId, [{ name: randName('P') }]);
    const storage = await seedLocation(ctx, randName('Storage'), 'storage');
    await seedStockAt(storage, p1!, 10);
    const res = await generate(ctx);
    expect((await res.json()).created).toBe(0);
  });

  it('apply performs the transfer and marks the suggestion applied', async () => {
    const ctx = await seedWarehouseClient();
    const { p1, storage, store } = await seedSlottingScenario(ctx);
    await generate(ctx);
    const s = ((await (await list(ctx, '?status=pending')).json()).suggestions as Array<{ id: string; suggested_qty: number }>)[0]!;

    const res = await decide(ctx, { suggestion_id: s.id, action: 'apply' });
    expect(res.status).toBe(200);

    expect(await readStockAt(store, p1)).toBe(s.suggested_qty);
    expect(await readStockAt(storage, p1)).toBe(10 - s.suggested_qty);

    const applied = ((await (await list(ctx, '?status=applied')).json()).suggestions as Array<{ id: string }>);
    expect(applied.map((x) => x.id)).toContain(s.id);
  });

  it('dismiss marks the suggestion dismissed without moving stock', async () => {
    const ctx = await seedWarehouseClient();
    const { p1, storage } = await seedSlottingScenario(ctx);
    await generate(ctx);
    const s = ((await (await list(ctx, '?status=pending')).json()).suggestions as Array<{ id: string }>)[0]!;
    const res = await decide(ctx, { suggestion_id: s.id, action: 'dismiss' });
    expect(res.status).toBe(200);
    expect(await readStockAt(storage, p1)).toBe(10);
    const dismissed = ((await (await list(ctx, '?status=dismissed')).json()).suggestions as Array<{ id: string }>);
    expect(dismissed.map((x) => x.id)).toContain(s.id);
  });

  it('404 deciding a foreign-client suggestion', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    await seedSlottingScenario(other);
    await generate(other);
    const foreign = ((await (await list(other, '?status=pending')).json()).suggestions as Array<{ id: string }>)[0]!;
    const res = await decide(ctx, { suggestion_id: foreign.id, action: 'apply' });
    expect(res.status).toBe(404);
  });

  it('412 when warehouse not enabled', async () => {
    const bare = await seedClientWithProductsEnabled();
    expect((await generateHandler(makeBucketUserRequest(bare, 'POST', '/api/warehouse/ai-slotting-generate', {}))).status).toBe(412);
  });
});
