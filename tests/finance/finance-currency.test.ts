import { describe, it, expect } from 'vitest';
import expensesHandler from '../../netlify/functions/finance-expenses';
import detailHandler from '../../netlify/functions/finance-expense-detail';
import summaryHandler from '../../netlify/functions/finance-summary';
import { seedFinanceClient, makeBucketUserRequest, currentMonth } from './_helpers';

const MONTH = currentMonth();
const today = () => new Date().toISOString().slice(0, 10);

describe('finance multicurrency', () => {
  it('computes base amount for a foreign-currency expense (USD → INR)', async () => {
    const ctx = await seedFinanceClient(); // base INR
    const res = await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'supplies', amount_cents: 5000, incurred_on: today(), // $50.00
      currency: 'USD', fx_rate: 83,
    }));
    expect(res.status).toBe(201);
    const b = await res.json() as any;
    expect(b.currency).toBe('USD');
    expect(b.amount_cents).toBe(5000);
    expect(b.fx_rate).toBe(83);
    expect(b.amount_base_cents).toBe(415000); // ₹4,150.00
  });

  it('handles zero-decimal currencies (JPY)', async () => {
    const ctx = await seedFinanceClient();
    const res = await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'other', amount_cents: 620, incurred_on: today(), // ¥620 (0 decimals)
      currency: 'JPY', fx_rate: 0.55,
    }));
    expect(res.status).toBe(201);
    const b = await res.json() as any;
    // 620 yen × 0.55 = ₹341.00 = 34100 paise
    expect(b.amount_base_cents).toBe(34100);
  });

  it('defaults to base currency with rate 1 when currency omitted', async () => {
    const ctx = await seedFinanceClient();
    const b = await (await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'rent', amount_cents: 30000, incurred_on: today(),
    }))).json() as any;
    expect(b.currency).toBe('INR');
    expect(b.fx_rate).toBe(1);
    expect(b.amount_base_cents).toBe(30000);
  });

  it('rejects a foreign currency without an fx_rate (400)', async () => {
    const ctx = await seedFinanceClient();
    const res = await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'supplies', amount_cents: 5000, incurred_on: today(), currency: 'USD',
    }));
    expect(res.status).toBe(400);
  });

  it('sums expenses in base currency across mixed currencies', async () => {
    const ctx = await seedFinanceClient();
    await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'rent', amount_cents: 30000, incurred_on: today(), // ₹300
    }));
    await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'supplies', amount_cents: 5000, incurred_on: today(), currency: 'USD', fx_rate: 83, // ₹4150
    }));
    const s = await (await summaryHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/finance/summary?month=${MONTH}`))).json() as any;
    expect(s.base_currency).toBe('INR');
    expect(s.expenses_cents).toBe(30000 + 415000);
  });

  it('recomputes base amount when a patch changes the fx_rate', async () => {
    const ctx = await seedFinanceClient();
    const created = await (await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'supplies', amount_cents: 5000, incurred_on: today(), currency: 'USD', fx_rate: 83,
    }))).json() as any;

    const patched = await (await detailHandler(makeBucketUserRequest(
      ctx, 'PATCH', `/api/finance/expense-detail/${created.id}`, { fx_rate: 100 }))).json() as any;
    expect(patched.fx_rate).toBe(100);
    expect(patched.amount_base_cents).toBe(500000); // $50 × 100 = ₹5,000
  });
});
