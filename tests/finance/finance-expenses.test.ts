import { describe, it, expect, beforeAll } from 'vitest';
import expensesHandler from '../../netlify/functions/finance-expenses';
import detailHandler from '../../netlify/functions/finance-expense-detail';
import {
  seedFinanceClient, seedClientWithProductsEnabled, grantPerms, seedSubordinateUser,
  makeBucketUserRequest, currentMonth, type PosTestCtx,
} from './_helpers';

const MONTH = currentMonth();
const today = () => new Date().toISOString().slice(0, 10);

describe('finance-expenses', () => {
  let ctx: PosTestCtx;
  beforeAll(async () => { ctx = await seedFinanceClient(); });

  it('creates an expense (201) and lists it for the month', async () => {
    const res = await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'supplies', amount_cents: 12345, incurred_on: today(), note: 'blades',
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.category).toBe('supplies');
    expect(body.amount_cents).toBe(12345);
    expect(body.id).toBeTruthy();

    const listRes = await expensesHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/finance/expenses?month=${MONTH}`));
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as any;
    expect(list.expenses.some((e: any) => e.id === body.id)).toBe(true);
  });

  it('rejects an unknown category (400)', async () => {
    const res = await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'yacht', amount_cents: 100, incurred_on: today(),
    }));
    expect(res.status).toBe(400);
  });

  it('rejects a negative amount (400)', async () => {
    const res = await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
      category: 'other', amount_cents: -5, incurred_on: today(),
    }));
    expect(res.status).toBe(400);
  });

  it('requires auth (401)', async () => {
    const res = await expensesHandler(
      new Request(`http://localhost/api/finance/expenses?month=${MONTH}`, { method: 'GET' }));
    expect(res.status).toBe(401);
  });

  it('returns 412 when the finance module is not enabled', async () => {
    const noFin = await seedClientWithProductsEnabled(); // products + pos only
    const res = await expensesHandler(
      makeBucketUserRequest(noFin, 'GET', `/api/finance/expenses?month=${MONTH}`));
    expect(res.status).toBe(412);
  });

  it('updates and deletes an expense', async () => {
    const created = await (await expensesHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
        category: 'rent', amount_cents: 5000, incurred_on: today(),
      }))).json() as any;

    const patchRes = await detailHandler(
      makeBucketUserRequest(ctx, 'PATCH', `/api/finance/expense-detail/${created.id}`, {
        amount_cents: 7500, category: 'utilities',
      }));
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json() as any;
    expect(patched.amount_cents).toBe(7500);
    expect(patched.category).toBe('utilities');

    const delRes = await detailHandler(
      makeBucketUserRequest(ctx, 'DELETE', `/api/finance/expense-detail/${created.id}`));
    expect(delRes.status).toBe(200);

    const list = await (await expensesHandler(
      makeBucketUserRequest(ctx, 'GET', `/api/finance/expenses?month=${MONTH}`))).json() as any;
    expect(list.expenses.some((e: any) => e.id === created.id)).toBe(false);
  });

  it('404s a malformed id', async () => {
    const res = await detailHandler(
      makeBucketUserRequest(ctx, 'DELETE', '/api/finance/expense-detail/not-a-uuid'));
    expect(res.status).toBe(404);
  });

  it('404s a cross-tenant expense (no leak)', async () => {
    const other = await seedFinanceClient();
    const created = await (await expensesHandler(
      makeBucketUserRequest(other, 'POST', '/api/finance/expenses', {
        category: 'rent', amount_cents: 999, incurred_on: today(),
      }))).json() as any;
    // ctx is a different client — must not be able to patch other's expense.
    const res = await detailHandler(
      makeBucketUserRequest(ctx, 'PATCH', `/api/finance/expense-detail/${created.id}`, { amount_cents: 1 }));
    expect(res.status).toBe(404);
  });

  it('enforces create permission for L2 (403 → 201 after grant)', async () => {
    const base = await seedFinanceClient();
    const sub = await seedSubordinateUser(base, 2, []); // no perms
    const denied = await expensesHandler(
      makeBucketUserRequest(sub, 'POST', '/api/finance/expenses', {
        category: 'other', amount_cents: 100, incurred_on: today(),
      }));
    expect(denied.status).toBe(403);

    await grantPerms(base.clientId, 2, ['finance.business.create']);
    const ok = await expensesHandler(
      makeBucketUserRequest(sub, 'POST', '/api/finance/expenses', {
        category: 'other', amount_cents: 100, incurred_on: today(),
      }));
    expect(ok.status).toBe(201);
  });
});
