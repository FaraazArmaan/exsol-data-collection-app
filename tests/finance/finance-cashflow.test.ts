import { describe, it, expect } from 'vitest';
import cashflowHandler from '../../netlify/functions/finance-cashflow';
import expensesHandler from '../../netlify/functions/finance-expenses';
import {
  seedFinanceClient, seedClientWithProductsEnabled, insertSale,
  makeBucketUserRequest, currentMonth,
} from './_helpers';

const MONTH = currentMonth();
const today = () => new Date().toISOString().slice(0, 10);

describe('finance-cashflow', () => {
  it('returns daily income + expense with month totals', async () => {
    const ctx = await seedFinanceClient();
    await insertSale(ctx.clientId, ctx.userNodeId, { source: 'pos', totalCents: 50000 });
    await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'rent', amount_cents: 20000, incurred_on: today(),
    }));

    const res = await cashflowHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/finance/cashflow?month=${MONTH}`));
    expect(res.status).toBe(200);
    const b = await res.json() as any;

    // Totals are timezone-independent aggregates over the whole month.
    expect(b.totals.income_cents).toBe(50000);
    expect(b.totals.expense_cents).toBe(20000);
    expect(b.totals.net_cents).toBe(30000);
    expect(b.days.length).toBeGreaterThanOrEqual(1);

    // The expense day is deterministic (incurred_on is a tz-naive DATE).
    const expenseDay = b.days.find((d: any) => d.date === today());
    expect(expenseDay).toBeTruthy();
    expect(expenseDay.expense_cents).toBe(20000);
  });

  it('returns empty days for a month with no activity', async () => {
    const ctx = await seedFinanceClient();
    const res = await cashflowHandler(
      makeBucketUserRequest(ctx, 'GET', '/api/finance/cashflow?month=2020-02'));
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.days).toEqual([]);
    expect(b.totals).toEqual({ income_cents: 0, expense_cents: 0, net_cents: 0 });
  });

  it('returns 412 when the finance module is not enabled', async () => {
    const noFin = await seedClientWithProductsEnabled();
    const res = await cashflowHandler(
      makeBucketUserRequest(noFin, 'GET', `/api/finance/cashflow?month=${MONTH}`));
    expect(res.status).toBe(412);
  });

  it('validates the month param (400)', async () => {
    const ctx = await seedFinanceClient();
    const res = await cashflowHandler(
      makeBucketUserRequest(ctx, 'GET', '/api/finance/cashflow?month=2026'));
    expect(res.status).toBe(400);
  });
});
