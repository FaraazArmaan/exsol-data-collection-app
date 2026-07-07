// GET/POST /api/finance/expenses — the expenses ledger, always scoped to a month.
//   GET  ?month=YYYY-MM → list expenses incurred that month (newest first).
//   POST                → create one expense (finance.business.create).
// Detail edits/deletes live in finance-expense-detail.ts (distinct path to avoid
// list-vs-:id ambiguity). Amounts are integer minor units of the row's currency;
// amount_base_cents is the value in the client base currency for aggregation.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { ExpenseCreate, MonthQuery } from './_finance-validators';
import { fetchBaseCurrency, resolveCurrency } from './_finance-fx';
import { fetchThreshold, initialApprovalStatus } from './_finance-settings';

export const config = { path: '/api/finance/expenses', method: ['GET', 'POST'] };

// neon returns BIGINT/NUMERIC as strings to avoid precision loss; coerce the
// money + rate fields to numbers so the wire shape matches the Expense type.
function shapeExpense(row: any) {
  return {
    ...row,
    amount_cents: Number(row.amount_cents),
    amount_base_cents: Number(row.amount_base_cents),
    fx_rate: Number(row.fx_rate),
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireFinance(req, ['finance.business.view']);
    if (!a.ok) return a.res;

    let q: MonthQuery;
    try {
      q = MonthQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    } catch (e: any) {
      return jsonError(400, 'invalid_query', { issues: e?.issues });
    }

    const sql = db();
    const monthStart = `${q.month}-01`;
    const rows = (await sql`
      SELECT id, client_id, category, amount_cents, currency, amount_base_cents,
             fx_rate, note, to_char(incurred_on, 'YYYY-MM-DD') AS incurred_on,
             created_by, created_at, template_id,
             approval_status, approved_by, approved_at, approval_note
      FROM public.finance_expenses
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND incurred_on >= ${monthStart}::date
        AND incurred_on <  (${monthStart}::date + interval '1 month')
      ORDER BY incurred_on DESC, created_at DESC
    `) as any[];
    return jsonOk({ expenses: rows.map(shapeExpense) });
  }

  if (req.method === 'POST') {
    const a = await requireFinance(req, ['finance.business.create']);
    if (!a.ok) return a.res;

    let body: ExpenseCreate;
    try {
      body = ExpenseCreate.parse(await req.json());
    } catch (e: any) {
      return jsonError(400, 'invalid_body', { issues: e?.issues });
    }

    const sql = db();
    const base = await fetchBaseCurrency(sql, a.ctx.clientId);
    const cur = resolveCurrency(body.amount_cents, base, body.currency, body.fx_rate);
    if ('error' in cur) return jsonError(400, cur.error);

    // Above the client approval threshold ⇒ created 'pending' (excluded from the
    // P&L until approved). Below (or approvals off) ⇒ NULL, counted immediately.
    const threshold = await fetchThreshold(sql, a.ctx.clientId);
    const approvalStatus = initialApprovalStatus(cur.amount_base_cents, threshold);

    const rows = (await sql`
      INSERT INTO public.finance_expenses
        (client_id, category, amount_cents, currency, amount_base_cents, fx_rate,
         note, incurred_on, created_by, approval_status)
      VALUES
        (${a.ctx.clientId}::uuid, ${body.category}, ${body.amount_cents},
         ${cur.currency}, ${cur.amount_base_cents}, ${cur.fx_rate},
         ${body.note ?? null}, ${body.incurred_on}::date, ${a.ctx.userNodeId}::uuid,
         ${approvalStatus})
      RETURNING id, client_id, category, amount_cents, currency, amount_base_cents,
                fx_rate, note, to_char(incurred_on, 'YYYY-MM-DD') AS incurred_on,
                created_by, created_at, template_id,
                approval_status, approved_by, approved_at, approval_note
    `) as any[];
    return jsonOk(shapeExpense(rows[0]), { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
