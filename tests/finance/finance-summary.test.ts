import { describe, it, expect } from 'vitest';
import summaryHandler from '../../netlify/functions/finance-summary';
import expensesHandler from '../../netlify/functions/finance-expenses';
import {
  seedFinanceClient, seedClientWithProductsEnabled, insertSale,
  makeBucketUserRequest, currentMonth, priorMonth,
} from './_helpers';

const MONTH = currentMonth();
const today = () => new Date().toISOString().slice(0, 10);

describe('finance-summary', () => {
  it('sums paid revenue by channel and nets expenses', async () => {
    const ctx = await seedFinanceClient();
    await insertSale(ctx.clientId, ctx.userNodeId, { source: 'pos', channel: 'instore', totalCents: 80000 });
    await insertSale(ctx.clientId, ctx.userNodeId, { source: 'pos', channel: 'instore', totalCents: 20000 });
    await insertSale(ctx.clientId, ctx.userNodeId, { source: 'storefront', channel: 'online', totalCents: 50000 });
    // An unpaid sale must NOT count toward revenue.
    await insertSale(ctx.clientId, ctx.userNodeId, { source: 'pos', totalCents: 999999, status: 'pending_payment' });
    await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'rent', amount_cents: 30000, incurred_on: today(),
    }));

    const res = await summaryHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/finance/summary?month=${MONTH}`));
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.revenue_by_channel.pos).toBe(100000);
    expect(b.revenue_by_channel.storefront).toBe(50000);
    expect(b.revenue_by_channel.booking).toBe(0);
    expect(b.revenue_cents).toBe(150000);
    expect(b.expenses_cents).toBe(30000);
    expect(b.net_cents).toBe(120000);
  });

  it('scopes revenue to the selected month', async () => {
    const ctx = await seedFinanceClient();
    const { month, firstDayISO } = priorMonth();
    await insertSale(ctx.clientId, ctx.userNodeId, { source: 'pos', totalCents: 12345, createdAt: firstDayISO });

    const thisM = await (await summaryHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/finance/summary?month=${MONTH}`))).json() as any;
    expect(thisM.revenue_cents).toBe(0);

    const priorM = await (await summaryHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/finance/summary?month=${month}`))).json() as any;
    expect(priorM.revenue_cents).toBe(12345);
  });

  it('returns 412 when the finance module is not enabled', async () => {
    const noFin = await seedClientWithProductsEnabled();
    const res = await summaryHandler(
      makeBucketUserRequest(noFin, 'GET', `/api/finance/summary?month=${MONTH}`));
    expect(res.status).toBe(412);
  });

  it('validates the month param (400)', async () => {
    const ctx = await seedFinanceClient();
    const res = await summaryHandler(
      makeBucketUserRequest(ctx, 'GET', '/api/finance/summary?month=2026'));
    expect(res.status).toBe(400);
  });
});
