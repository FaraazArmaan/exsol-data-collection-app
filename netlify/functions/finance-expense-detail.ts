// PATCH/DELETE /api/finance/expense-detail/:id — edit or remove one expense.
// Every query is scoped by client_id so a cross-tenant id reads as 404 (never
// leaking existence). Distinct path segment (`expense-detail`) keeps it clear of
// the list route /api/finance/expenses. Mirrors booking-service-detail.ts.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { ExpensePatch } from './_finance-validators';
import { fetchBaseCurrency, resolveCurrency } from './_finance-fx';

export const config = { path: '/api/finance/expense-detail/:id', method: ['PATCH', 'DELETE'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

// neon returns BIGINT/NUMERIC as strings; coerce the money + rate fields so the
// wire shape matches the Expense type. Mirror of finance-expenses.ts.
function shapeExpense(row: any) {
  return {
    ...row,
    amount_cents: Number(row.amount_cents),
    amount_base_cents: Number(row.amount_base_cents),
    fx_rate: Number(row.fx_rate),
  };
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  // Guard bad ids up front — a malformed ::uuid cast would 22P02; collapse to
  // 404 so the "doesn't exist" surface stays consistent.
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  if (req.method === 'PATCH') {
    const a = await requireFinance(req, ['finance.business.edit']);
    if (!a.ok) return a.res;

    let patch: ExpensePatch;
    try {
      patch = ExpensePatch.parse(await req.json());
    } catch (e: any) {
      return jsonError(400, 'invalid_body', { issues: e?.issues });
    }

    const sql = db();
    // Fetch current row (client-scoped) so we can recompute the base amount from
    // the MERGED amount/currency/rate — a partial patch can change any of them.
    const existing = (await sql`
      SELECT amount_cents, currency, fx_rate
      FROM public.finance_expenses
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      LIMIT 1
    `) as Array<{ amount_cents: string; currency: string; fx_rate: string }>;
    if (!existing[0]) return jsonError(404, 'not_found');

    const amountCents = patch.amount_cents ?? Number(existing[0].amount_cents);
    const currency = patch.currency ?? existing[0].currency;
    const fxRate = patch.fx_rate ?? Number(existing[0].fx_rate);
    const base = await fetchBaseCurrency(sql, a.ctx.clientId);
    const cur = resolveCurrency(amountCents, base, currency, fxRate);
    if ('error' in cur) return jsonError(400, cur.error);

    const rows = (await sql`
      UPDATE public.finance_expenses SET
        category          = COALESCE(${patch.category ?? null}, category),
        amount_cents      = ${amountCents},
        currency          = ${cur.currency},
        amount_base_cents = ${cur.amount_base_cents},
        fx_rate           = ${cur.fx_rate},
        incurred_on       = COALESCE(${patch.incurred_on ?? null}::date, incurred_on),
        note              = CASE WHEN ${patch.note !== undefined} THEN ${patch.note ?? null} ELSE note END,
        updated_at        = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, client_id, category, amount_cents, currency, amount_base_cents,
                fx_rate, note, to_char(incurred_on, 'YYYY-MM-DD') AS incurred_on,
                created_by, created_at, template_id,
                approval_status, approved_by, approved_at, approval_note
    `) as any[];
    if (!rows[0]) return jsonError(404, 'not_found');
    return jsonOk(shapeExpense(rows[0]));
  }

  // DELETE — hard delete; expenses carry no downstream FK references.
  const a = await requireFinance(req, ['finance.business.delete']);
  if (!a.ok) return a.res;
  const sql = db();
  const rows = (await sql`
    DELETE FROM public.finance_expenses
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id
  `) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  return jsonOk({ id: rows[0].id, deleted: true });
}
