import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import expensesHandler from '../../netlify/functions/finance-expenses';
import summaryHandler from '../../netlify/functions/finance-summary';
import settingsHandler from '../../netlify/functions/finance-settings';
import approvalsHandler from '../../netlify/functions/finance-approvals';
import decideHandler from '../../netlify/functions/finance-approval-decide';
import {
  seedFinanceClient, seedClientWithProductsEnabled, seedSubordinateUser, grantPerms,
  makeBucketUserRequest, currentMonth,
} from './_helpers';

const sql = neon(process.env.DATABASE_URL!);
const MONTH = currentMonth();
const today = () => new Date().toISOString().slice(0, 10);

async function setThreshold(ctx: any, cents: number) {
  return settingsHandler(makeBucketUserRequest(ctx, 'PUT', '/api/finance/settings', { approval_threshold_cents: cents }));
}
async function createExpense(ctx: any, amount_cents: number) {
  const res = await expensesHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/expenses', {
    category: 'equipment', amount_cents, incurred_on: today(),
  }));
  return res.json() as any;
}
async function expensesTotal(ctx: any): Promise<number> {
  const s = await (await summaryHandler(makeBucketUserRequest(ctx, 'GET', `/api/finance/summary?month=${MONTH}`))).json() as any;
  return s.expenses_cents;
}

describe('finance-approvals', () => {
  it('gates expenses at/above the threshold as pending and excludes them from the P&L', async () => {
    const ctx = await seedFinanceClient();
    await setThreshold(ctx, 100000); // ₹1,000

    const below = await createExpense(ctx, 50000);  // ₹500 → auto
    const above = await createExpense(ctx, 200000); // ₹2,000 → pending
    expect(below.approval_status).toBe(null);
    expect(above.approval_status).toBe('pending');

    // Only the below-threshold expense counts.
    expect(await expensesTotal(ctx)).toBe(50000);

    // It surfaces in the pending queue.
    const pending = await (await approvalsHandler(
      makeBucketUserRequest(ctx, 'GET', '/api/finance/approvals?status=pending'))).json() as any;
    expect(pending.approvals.some((e: any) => e.id === above.id)).toBe(true);
  });

  it('approving a pending expense makes it count + writes an audit row', async () => {
    const ctx = await seedFinanceClient();
    await setThreshold(ctx, 100000);
    const above = await createExpense(ctx, 200000);
    expect(await expensesTotal(ctx)).toBe(0);

    const res = await decideHandler(makeBucketUserRequest(
      ctx, 'POST', `/api/finance/approval-decide/${above.id}`, { decision: 'approve', note: 'ok' }));
    expect(res.status).toBe(200);
    expect(await expensesTotal(ctx)).toBe(200000);

    const audit = (await sql`
      SELECT op FROM public.audit_log
      WHERE target_type = 'finance_expense' AND target_id = ${above.id} AND op = 'finance.expense.approved'
    `) as any[];
    expect(audit.length).toBe(1);
  });

  it('rejecting keeps it out of the P&L and lands in decided history', async () => {
    const ctx = await seedFinanceClient();
    await setThreshold(ctx, 100000);
    const above = await createExpense(ctx, 200000);
    await decideHandler(makeBucketUserRequest(
      ctx, 'POST', `/api/finance/approval-decide/${above.id}`, { decision: 'reject', note: 'not approved' }));
    expect(await expensesTotal(ctx)).toBe(0);

    const decided = await (await approvalsHandler(
      makeBucketUserRequest(ctx, 'GET', '/api/finance/approvals?status=decided'))).json() as any;
    const row = decided.approvals.find((e: any) => e.id === above.id);
    expect(row.approval_status).toBe('rejected');
    expect(row.approval_note).toBe('not approved');
  });

  it('a second decision on the same expense is 404 (no double-decide)', async () => {
    const ctx = await seedFinanceClient();
    await setThreshold(ctx, 100000);
    const above = await createExpense(ctx, 200000);
    await decideHandler(makeBucketUserRequest(ctx, 'POST', `/api/finance/approval-decide/${above.id}`, { decision: 'approve' }));
    const again = await decideHandler(makeBucketUserRequest(ctx, 'POST', `/api/finance/approval-decide/${above.id}`, { decision: 'reject' }));
    expect(again.status).toBe(404);
  });

  it('GET settings reflects a saved threshold', async () => {
    const ctx = await seedFinanceClient();
    await setThreshold(ctx, 75000);
    const s = await (await settingsHandler(makeBucketUserRequest(ctx, 'GET', '/api/finance/settings'))).json() as any;
    expect(s.approval_threshold_cents).toBe(75000);
    expect(s.base_currency).toBe('INR');
  });

  it('setting the threshold requires edit permission (L2 403 → 200 after grant)', async () => {
    const base = await seedFinanceClient();
    const sub = await seedSubordinateUser(base, 2, ['finance.business.view']);
    const denied = await setThreshold(sub, 50000);
    expect(denied.status).toBe(403);
    await grantPerms(base.clientId, 2, ['finance.business.view', 'finance.business.edit']);
    const ok = await setThreshold(sub, 50000);
    expect(ok.status).toBe(200);
  });

  it('returns 412 when the finance module is not enabled', async () => {
    const noFin = await seedClientWithProductsEnabled();
    const res = await approvalsHandler(makeBucketUserRequest(noFin, 'GET', '/api/finance/approvals?status=pending'));
    expect(res.status).toBe(412);
  });
});
