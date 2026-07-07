import { describe, it, expect } from 'vitest';
import kanbanHandler from '../../netlify/functions/manufacturing-kanban';
import boardHandler from '../../netlify/functions/manufacturing-order-board';
import { makeBucketUserRequest, seedProducts, seedClientWithProductsEnabled, seedSubordinateUser } from '../pos/_helpers';
import { seedManufacturingClient, seedBom, seedOrder } from './_helpers';

type Ctx = Awaited<ReturnType<typeof seedManufacturingClient>>;
const board = (ctx: Ctx) => kanbanHandler(makeBucketUserRequest(ctx, 'GET', '/api/manufacturing/kanban'));
const setBoard = (ctx: Ctx, body: unknown) => boardHandler(makeBucketUserRequest(ctx, 'POST', '/api/manufacturing/order-board', body));

async function seedOrderFor(ctx: Ctx, status = 'planned'): Promise<string> {
  const [out, comp] = await seedProducts(ctx.clientId, [{ name: 'Out' }, { name: 'Comp' }]);
  const bom = await seedBom(ctx, out!, [{ productId: comp!, qty: 2 }]);
  return seedOrder(ctx, bom, 5, status);
}

describe('manufacturing kanban', () => {
  it('board returns orders with board fields, grouped by status', async () => {
    const ctx = await seedManufacturingClient();
    const id = await seedOrderFor(ctx, 'planned');
    const res = await board(ctx);
    expect(res.status).toBe(200);
    const items = (await res.json()).items as Array<{ id: string; status: string; board_rank: number; priority: string; due_on: string | null }>;
    const row = items.find((i) => i.id === id);
    expect(row).toBeTruthy();
    expect(row!.status).toBe('planned');
    expect(row!.priority).toBe('normal');
    expect(row!.board_rank).toBe(0);
  });

  it('order-board updates rank, priority and due date', async () => {
    const ctx = await seedManufacturingClient();
    const id = await seedOrderFor(ctx);
    const res = await setBoard(ctx, { id, board_rank: 3, priority: 'high', due_on: '2026-08-01' });
    expect(res.status).toBe(200);
    const items = (await (await board(ctx)).json()).items as Array<{ id: string; board_rank: number; priority: string; due_on: string | null }>;
    const row = items.find((i) => i.id === id)!;
    expect(row.board_rank).toBe(3);
    expect(row.priority).toBe('high');
    expect(row.due_on).toBe('2026-08-01');
  });

  it('400 for an invalid priority', async () => {
    const ctx = await seedManufacturingClient();
    const id = await seedOrderFor(ctx);
    const res = await setBoard(ctx, { id, priority: 'urgent' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('priority_invalid');
  });

  it('404 for a foreign-client order', async () => {
    const ctx = await seedManufacturingClient();
    const other = await seedManufacturingClient();
    const foreign = await seedOrderFor(other);
    const res = await setBoard(ctx, { id: foreign, board_rank: 1 });
    expect(res.status).toBe(404);
  });

  it('412 when manufacturing not enabled', async () => {
    const bare = await seedClientWithProductsEnabled();
    expect((await board(bare)).status).toBe(412);
  });

  it('403 for an L2 lacking manufacturing.products.edit on board update', async () => {
    const ctx = await seedManufacturingClient();
    const id = await seedOrderFor(ctx);
    const viewer = await seedSubordinateUser(ctx, 2, ['manufacturing.products.view']);
    expect((await setBoard(viewer, { id, board_rank: 1 })).status).toBe(403);
  });
});
