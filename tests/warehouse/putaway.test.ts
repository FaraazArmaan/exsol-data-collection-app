import { describe, it, expect } from 'vitest';
import putawayHandler from '../../netlify/functions/warehouse-putaway';
import generateHandler from '../../netlify/functions/warehouse-putaway-generate';
import confirmHandler from '../../netlify/functions/warehouse-putaway-confirm';
import { makeBucketUserRequest, seedProducts } from '../pos/_helpers';
import {
  seedWarehouseClient, seedLocation, seedReceivedPO, readStockAt, readPutawayTasks, randName,
} from './_helpers';

const generate = (ctx: Awaited<ReturnType<typeof seedWarehouseClient>>) =>
  generateHandler(makeBucketUserRequest(ctx, 'POST', '/api/warehouse/putaway-generate', {}));
const list = (ctx: Awaited<ReturnType<typeof seedWarehouseClient>>, qs = '') =>
  putawayHandler(makeBucketUserRequest(ctx, 'GET', `/api/warehouse/putaway${qs}`));
const confirm = (ctx: Awaited<ReturnType<typeof seedWarehouseClient>>, body: unknown) =>
  confirmHandler(makeBucketUserRequest(ctx, 'POST', '/api/warehouse/putaway-confirm', body));

describe('warehouse putaway', () => {
  it('generate enqueues one pending task per received-PO item, idempotently', async () => {
    const ctx = await seedWarehouseClient();
    const [p1, p2] = await seedProducts(ctx.clientId, [{ name: randName('P') }, { name: randName('P') }]);
    await seedReceivedPO(ctx, [{ productId: p1!, qty: 8 }, { productId: p2!, qty: 3 }]);

    const res = await generate(ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(2);

    // re-run creates nothing (idempotent on purchase_order_item_id)
    expect((await (await generate(ctx)).json()).created).toBe(0);

    const tasks = await readPutawayTasks(ctx);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.status === 'pending')).toBe(true);
  });

  it('does not generate tasks for POs that are not received', async () => {
    const ctx = await seedWarehouseClient();
    const [p1] = await seedProducts(ctx.clientId, [{ name: randName('P') }]);
    await seedReceivedPO(ctx, [{ productId: p1!, qty: 5 }], 'ordered');
    const res = await generate(ctx);
    expect((await res.json()).created).toBe(0);
  });

  it('list returns pending tasks with product + PO context', async () => {
    const ctx = await seedWarehouseClient();
    const [p1] = await seedProducts(ctx.clientId, [{ name: 'Widget ' + randName() }]);
    await seedReceivedPO(ctx, [{ productId: p1!, qty: 6 }]);
    await generate(ctx);
    const res = await list(ctx, '?status=pending');
    expect(res.status).toBe(200);
    const tasks = (await res.json()).tasks as Array<{ product_id: string; product_name: string; qty: number }>;
    expect(tasks.some((t) => t.product_id === p1 && t.qty === 6 && t.product_name.startsWith('Widget'))).toBe(true);
  });

  it('confirm allocates stock to the location, writes a transfer movement, marks done', async () => {
    const ctx = await seedWarehouseClient();
    const [p1] = await seedProducts(ctx.clientId, [{ name: randName('P') }]);
    const loc = await seedLocation(ctx, randName('Bin'));
    await seedReceivedPO(ctx, [{ productId: p1!, qty: 9 }]);
    await generate(ctx);
    const taskId = (await readPutawayTasks(ctx))[0]!.id;

    const res = await confirm(ctx, { task_id: taskId, location_id: loc });
    expect(res.status).toBe(200);
    expect(await readStockAt(loc, p1!)).toBe(9);

    const done = (await readPutawayTasks(ctx))[0]!;
    expect(done.status).toBe('done');
    expect(done.location_id).toBe(loc);

    const mv = (await (await list(ctx, '?status=done')).json()).tasks;
    expect(mv).toHaveLength(1);
  });

  it('confirm 409 when the task is already done', async () => {
    const ctx = await seedWarehouseClient();
    const [p1] = await seedProducts(ctx.clientId, [{ name: randName('P') }]);
    const loc = await seedLocation(ctx, randName('Bin'));
    await seedReceivedPO(ctx, [{ productId: p1!, qty: 4 }]);
    await generate(ctx);
    const taskId = (await readPutawayTasks(ctx))[0]!.id;
    await confirm(ctx, { task_id: taskId, location_id: loc });
    const res = await confirm(ctx, { task_id: taskId, location_id: loc });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('task_not_pending');
  });

  it('confirm 404 for a foreign-client task', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const [p1] = await seedProducts(other.clientId, [{ name: randName('P') }]);
    const loc = await seedLocation(ctx, randName('Bin'));
    await seedReceivedPO(other, [{ productId: p1!, qty: 4 }]);
    await generateHandler(makeBucketUserRequest(other, 'POST', '/api/warehouse/putaway-generate', {}));
    const foreignTask = (await readPutawayTasks(other))[0]!.id;
    const res = await confirm(ctx, { task_id: foreignTask, location_id: loc });
    expect(res.status).toBe(404);
  });

  it('confirm 404 for a foreign-client location', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const [p1] = await seedProducts(ctx.clientId, [{ name: randName('P') }]);
    const foreignLoc = await seedLocation(other, randName('Bin'));
    await seedReceivedPO(ctx, [{ productId: p1!, qty: 4 }]);
    await generate(ctx);
    const taskId = (await readPutawayTasks(ctx))[0]!.id;
    const res = await confirm(ctx, { task_id: taskId, location_id: foreignLoc });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('location_not_found');
  });

  it('412 when warehouse not enabled', async () => {
    const { seedClientWithProductsEnabled } = await import('../pos/_helpers');
    const bare = await seedClientWithProductsEnabled();
    const res = await generateHandler(makeBucketUserRequest(bare, 'POST', '/api/warehouse/putaway-generate', {}));
    expect(res.status).toBe(412);
  });
});
