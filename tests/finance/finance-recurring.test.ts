import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import recurringHandler from '../../netlify/functions/finance-recurring';
import detailHandler from '../../netlify/functions/finance-recurring-detail';
import runHandler from '../../netlify/functions/finance-recurring-run';
import { materializeDueTemplates } from '../../netlify/functions/_finance-recurring';
import { seedFinanceClient, seedClientWithProductsEnabled, makeBucketUserRequest } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

async function createTemplate(ctx: any, body: any) {
  const res = await recurringHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/recurring', body));
  return { status: res.status, body: await res.json() as any };
}

describe('finance-recurring', () => {
  it('creates a template (201), defaults to base currency, and lists it', async () => {
    const ctx = await seedFinanceClient();
    const { status, body } = await createTemplate(ctx, {
      category: 'rent', amount_cents: 2500000, cadence: 'monthly', next_run: '2026-01-01', note: 'Shop rent',
    });
    expect(status).toBe(201);
    expect(body.currency).toBe('INR');
    expect(body.fx_rate).toBe(1);
    expect(body.active).toBe(true);

    const list = await (await recurringHandler(
      makeBucketUserRequest(ctx, 'GET', '/api/finance/recurring'))).json() as any;
    expect(list.base_currency).toBe('INR');
    expect(list.templates.some((t: any) => t.id === body.id)).toBe(true);
  });

  it('materializes a due monthly template into an expense and advances next_run', async () => {
    const ctx = await seedFinanceClient();
    const { body: t } = await createTemplate(ctx, {
      category: 'utilities', amount_cents: 500000, cadence: 'monthly', next_run: '2020-01-15',
    });
    const n = await materializeDueTemplates(sql as any, { clientId: ctx.clientId });
    expect(n).toBeGreaterThanOrEqual(1);

    const exp = (await sql`
      SELECT to_char(incurred_on,'YYYY-MM-DD') AS d, amount_base_cents, template_id
      FROM public.finance_expenses WHERE template_id = ${t.id}::uuid
    `) as any[];
    expect(exp.length).toBe(1);
    expect(exp[0].d).toBe('2020-01-15');
    expect(Number(exp[0].amount_base_cents)).toBe(500000);

    const tmpl = (await sql`
      SELECT to_char(next_run,'YYYY-MM-DD') AS d, active FROM public.finance_recurring_templates WHERE id = ${t.id}::uuid
    `) as any[];
    expect(tmpl[0].d).toBe('2020-02-15'); // advanced one month
    expect(tmpl[0].active).toBe(true);
  });

  it('deactivates a one-time milestone after firing', async () => {
    const ctx = await seedFinanceClient();
    const { body: t } = await createTemplate(ctx, {
      category: 'equipment', amount_cents: 1000000, cadence: 'once', next_run: '2020-03-10',
    });
    await materializeDueTemplates(sql as any, { clientId: ctx.clientId });
    const tmpl = (await sql`
      SELECT active FROM public.finance_recurring_templates WHERE id = ${t.id}::uuid
    `) as any[];
    expect(tmpl[0].active).toBe(false);
  });

  it('materializes a foreign-currency template at the right base amount', async () => {
    const ctx = await seedFinanceClient();
    const { body: t } = await createTemplate(ctx, {
      category: 'supplies', amount_cents: 5000, cadence: 'monthly', next_run: '2020-05-01',
      currency: 'USD', fx_rate: 83,
    });
    await materializeDueTemplates(sql as any, { clientId: ctx.clientId });
    const exp = (await sql`
      SELECT amount_base_cents, currency FROM public.finance_expenses WHERE template_id = ${t.id}::uuid
    `) as any[];
    expect(exp[0].currency).toBe('USD');
    expect(Number(exp[0].amount_base_cents)).toBe(415000); // $50 × 83 = ₹4150
  });

  it('run endpoint materializes due templates for the caller client', async () => {
    const ctx = await seedFinanceClient();
    await createTemplate(ctx, { category: 'rent', amount_cents: 100, cadence: 'monthly', next_run: '2020-01-01' });
    const res = await runHandler(makeBucketUserRequest(ctx, 'POST', '/api/finance/recurring-run'));
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.materialized).toBeGreaterThanOrEqual(1);
  });

  it('rejects a foreign template without an fx_rate (400)', async () => {
    const ctx = await seedFinanceClient();
    const { status } = await createTemplate(ctx, {
      category: 'supplies', amount_cents: 5000, cadence: 'monthly', next_run: '2026-01-01', currency: 'USD',
    });
    expect(status).toBe(400);
  });

  it('paused templates are skipped by materialization', async () => {
    const ctx = await seedFinanceClient();
    const { body: t } = await createTemplate(ctx, {
      category: 'rent', amount_cents: 100, cadence: 'monthly', next_run: '2020-01-01',
    });
    await detailHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/finance/recurring-detail/${t.id}`, { active: false }));
    await materializeDueTemplates(sql as any, { clientId: ctx.clientId });
    const exp = (await sql`
      SELECT id FROM public.finance_expenses WHERE template_id = ${t.id}::uuid
    `) as any[];
    expect(exp.length).toBe(0);
  });

  it('returns 412 when the finance module is not enabled', async () => {
    const noFin = await seedClientWithProductsEnabled();
    const res = await recurringHandler(makeBucketUserRequest(noFin, 'GET', '/api/finance/recurring'));
    expect(res.status).toBe(412);
  });
});
