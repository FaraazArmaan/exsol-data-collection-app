import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import ordersHandler from '../../netlify/functions/procurement-orders';
import grnHandler from '../../netlify/functions/procurement-grn';
import invoicesHandler from '../../netlify/functions/procurement-invoices';
import matchHandler from '../../netlify/functions/procurement-match';
import { seedProcurementClient, seedSupplier } from './_helpers';
import { seedProducts, makeBucketUserRequest } from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);
type Ctx = Awaited<ReturnType<typeof seedProcurementClient>>;

async function createPO(ctx: Ctx, sup: string, prod: string, qty: number, unitCost: number): Promise<string> {
  const res = await ordersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/orders', {
    supplier_id: sup, items: [{ product_id: prod, qty, unit_cost_cents: unitCost }],
  }));
  return (await res.json()).id as string;
}
const grn = (ctx: Ctx, poId: string, prod: string, qty: number) =>
  grnHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/grn', { purchase_order_id: poId, items: [{ product_id: prod, qty_received: qty }] }));
const invoice = (ctx: Ctx, poId: string, num: string, amount: number) =>
  invoicesHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/invoices', { purchase_order_id: poId, invoice_number: num, amount_cents: amount }));
const getMatch = (ctx: Ctx, poId: string) =>
  matchHandler(makeBucketUserRequest(ctx, 'GET', `/api/procurement/match?purchase_order_id=${poId}`));
const confirm = (ctx: Ctx, poId: string) =>
  matchHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/match', { purchase_order_id: poId }));
const financeCount = async (ctx: Ctx) =>
  (((await sql`SELECT count(*)::int AS n FROM public.finance_expenses WHERE client_id = ${ctx.clientId}`) as Array<{ n: number }>)[0]!).n;

describe('procurement 3-way match', () => {
  it('reports no_grn/no_invoice before receipts are recorded', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const prod = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const po = await createPO(ctx, sup, prod, 10, 100);
    const m = await (await getMatch(ctx, po)).json();
    expect(m.matched).toBe(false);
    expect(m.received_recorded).toBe(false);
    expect(m.invoice_recorded).toBe(false);
    expect(m.mismatches.some((x: { type: string }) => x.type === 'no_grn')).toBe(true);
  });

  it('confirms a clean match and creates a Finance expense (idempotent)', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const prod = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const po = await createPO(ctx, sup, prod, 10, 100); // total 1000
    await grn(ctx, po, prod, 10);
    await invoice(ctx, po, 'INV-1', 1000);

    const m = await (await getMatch(ctx, po)).json();
    expect(m.matched).toBe(true);

    const before = await financeCount(ctx);
    const res = await confirm(ctx, po);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.amount_cents).toBe(1000);
    expect(await financeCount(ctx)).toBe(before + 1);

    const exp = (await sql`SELECT category, amount_cents FROM public.finance_expenses WHERE id = ${body.expense_id}`) as Array<{ category: string; amount_cents: string }>;
    expect(exp[0]!.category).toBe('supplies');
    expect(Number(exp[0]!.amount_cents)).toBe(1000);

    // the PO is now expensed; a second confirm is a 409
    expect((await (await getMatch(ctx, po)).json()).expensed).toBe(true);
    expect((await confirm(ctx, po)).status).toBe(409);
    expect(await financeCount(ctx)).toBe(before + 1); // no double expense
  });

  it('409 confirming a quantity mismatch', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const prod = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const po = await createPO(ctx, sup, prod, 10, 100);
    await grn(ctx, po, prod, 8); // received != ordered
    await invoice(ctx, po, 'INV-2', 1000);
    expect((await confirm(ctx, po)).status).toBe(409);
  });

  it('409 confirming an amount mismatch', async () => {
    const ctx = await seedProcurementClient();
    const sup = await seedSupplier(ctx, 'S');
    const prod = (await seedProducts(ctx.clientId, [{ name: 'P' }]))[0]!;
    const po = await createPO(ctx, sup, prod, 10, 100); // total 1000
    await grn(ctx, po, prod, 10);
    await invoice(ctx, po, 'INV-3', 900); // invoiced != PO total
    expect((await confirm(ctx, po)).status).toBe(409);
  });
});
