import { describe, it, expect } from 'vitest';
import aiHandler from '../../netlify/functions/finance-ai-insights';
import expensesHandler from '../../netlify/functions/finance-expenses';
import {
  seedFinanceClient, seedClientWithProductsEnabled, insertSale,
  makeBucketUserRequest, currentMonth,
} from './_helpers';

const MONTH = currentMonth();
const today = () => new Date().toISOString().slice(0, 10);

async function addExpense(ctx: any, amount_cents: number) {
  return expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
    category: 'rent', amount_cents, incurred_on: today(),
  }));
}

describe('finance-ai-insights', () => {
  it('generates a rule-based insight (no API key in dev) with narrative + anomalies', async () => {
    const ctx = await seedFinanceClient();
    await insertSale(ctx.clientId, ctx.userNodeId, { source: 'pos', totalCents: 100000 });
    await addExpense(ctx, 20000);

    const res = await aiHandler(makeBucketUserRequest(ctx, 'GET', `/api/finance/ai-insights?month=${MONTH}`));
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.is_fallback).toBe(true); // no ANTHROPIC_API_KEY in dev
    expect(typeof b.narrative).toBe('string');
    expect(b.narrative.length).toBeGreaterThan(0);
    expect(Array.isArray(b.anomalies)).toBe(true);
    expect(b.anomalies.length).toBeGreaterThanOrEqual(1);
    expect(b.health_score).toBeGreaterThanOrEqual(0);
    expect(b.health_score).toBeLessThanOrEqual(100);
    expect(b.base_currency).toBe('INR');
    expect(b.facts.revenue_cents).toBe(100000);
    expect(b.facts.expenses_cents).toBe(20000);
    expect(b.facts.net_cents).toBe(80000);
  });

  it('flags a net loss as a high-severity anomaly', async () => {
    const ctx = await seedFinanceClient();
    await addExpense(ctx, 500000); // expense with no revenue → loss
    const b = await (await aiHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/finance/ai-insights?month=${MONTH}`))).json() as any;
    expect(b.facts.net_cents).toBeLessThan(0);
    expect(b.anomalies.some((a: any) => a.severity === 'high')).toBe(true);
  });

  it('caches the report and regenerates on POST', async () => {
    const ctx = await seedFinanceClient();
    const first = await (await aiHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/finance/ai-insights?month=${MONTH}`))).json() as any;
    expect(first.cached).toBe(false);

    const second = await (await aiHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/finance/ai-insights?month=${MONTH}`))).json() as any;
    expect(second.cached).toBe(true);

    const regen = await (await aiHandler(
      makeBucketUserRequest(ctx, 'POST', `/api/finance/ai-insights?month=${MONTH}`))).json() as any;
    expect(regen.cached).toBe(false);
  });

  it('returns 412 when the finance module is not enabled', async () => {
    const noFin = await seedClientWithProductsEnabled();
    const res = await aiHandler(makeBucketUserRequest(noFin, 'GET', `/api/finance/ai-insights?month=${MONTH}`));
    expect(res.status).toBe(412);
  });

  it('validates the month param (400)', async () => {
    const ctx = await seedFinanceClient();
    const res = await aiHandler(makeBucketUserRequest(ctx, 'GET', '/api/finance/ai-insights?month=nope'));
    expect(res.status).toBe(400);
  });
});
