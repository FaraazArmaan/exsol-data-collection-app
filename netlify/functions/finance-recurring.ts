// GET/POST /api/finance/recurring — recurring + milestone expense templates.
//   GET  → list all templates for the client (active first, then next_run).
//   POST → create a template (finance.business.create).
// Templates store amount_cents + currency + fx_rate; the base amount is computed
// at materialization time (client base currency can change independently).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { RecurringCreate } from './_finance-validators';
import { fetchBaseCurrency, resolveCurrency } from './_finance-fx';

export const config = { path: '/api/finance/recurring', method: ['GET', 'POST'] };

export function shapeTemplate(row: any) {
  return { ...row, amount_cents: Number(row.amount_cents), fx_rate: Number(row.fx_rate) };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireFinance(req, ['finance.business.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT id, client_id, category, amount_cents, currency, fx_rate, note, cadence,
             to_char(next_run, 'YYYY-MM-DD') AS next_run, active,
             to_char(last_materialized_on, 'YYYY-MM-DD') AS last_materialized_on,
             created_by, created_at
      FROM public.finance_recurring_templates
      WHERE client_id = ${a.ctx.clientId}::uuid
      ORDER BY active DESC, next_run ASC
    `) as any[];
    const base_currency = await fetchBaseCurrency(sql, a.ctx.clientId);
    return jsonOk({ templates: rows.map(shapeTemplate), base_currency });
  }

  if (req.method === 'POST') {
    const a = await requireFinance(req, ['finance.business.create']);
    if (!a.ok) return a.res;

    let body: RecurringCreate;
    try {
      body = RecurringCreate.parse(await req.json());
    } catch (e: any) {
      return jsonError(400, 'invalid_body', { issues: e?.issues });
    }

    const sql = db();
    const base = await fetchBaseCurrency(sql, a.ctx.clientId);
    // Reuse the expense currency rules — a foreign template needs an fx_rate.
    const cur = resolveCurrency(body.amount_cents, base, body.currency, body.fx_rate);
    if ('error' in cur) return jsonError(400, cur.error);

    const rows = (await sql`
      INSERT INTO public.finance_recurring_templates
        (client_id, category, amount_cents, currency, fx_rate, note, cadence, next_run, created_by)
      VALUES
        (${a.ctx.clientId}::uuid, ${body.category}, ${body.amount_cents}, ${cur.currency},
         ${cur.fx_rate}, ${body.note ?? null}, ${body.cadence}, ${body.next_run}::date, ${a.ctx.userNodeId}::uuid)
      RETURNING id, client_id, category, amount_cents, currency, fx_rate, note, cadence,
                to_char(next_run, 'YYYY-MM-DD') AS next_run, active,
                to_char(last_materialized_on, 'YYYY-MM-DD') AS last_materialized_on,
                created_by, created_at
    `) as any[];
    return jsonOk(shapeTemplate(rows[0]), { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
