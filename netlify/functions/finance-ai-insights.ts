// GET/POST /api/finance/ai-insights?month=YYYY-MM — AI P&L narrative + anomalies.
//   GET  → return the cached report, generating one if absent (view perm).
//   POST → force a fresh generation, overwriting the cache (edit perm — an LLM
//          call has a cost, so regeneration is the more-privileged action).
// Reports are cached per (client, month) in finance_ai_reports. Without an
// ANTHROPIC_API_KEY the seam returns a deterministic rule-based summary
// (is_fallback: true) so the dashboard still works in dev.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { MonthQuery } from './_finance-validators';
import { fetchBaseCurrency } from './_finance-fx';
import { generateInsight } from './_finance-ai';

export const config = { path: '/api/finance/ai-insights', method: ['GET', 'POST'] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const refresh = req.method === 'POST';
  const a = await requireFinance(req, [refresh ? 'finance.business.edit' : 'finance.business.view']);
  if (!a.ok) return a.res;

  let q: MonthQuery;
  try {
    q = MonthQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  } catch (e: any) {
    return jsonError(400, 'invalid_query', { issues: e?.issues });
  }

  const sql = db();
  const base = await fetchBaseCurrency(sql, a.ctx.clientId);

  if (!refresh) {
    const cached = (await sql`
      SELECT payload, model, is_fallback, generated_at
      FROM public.finance_ai_reports
      WHERE client_id = ${a.ctx.clientId}::uuid AND month = ${q.month}
      LIMIT 1
    `) as Array<{ payload: any; model: string; is_fallback: boolean; generated_at: string }>;
    if (cached[0]) {
      return jsonOk({
        month: q.month, base_currency: base, ...cached[0].payload,
        model: cached[0].model, is_fallback: cached[0].is_fallback,
        generated_at: cached[0].generated_at, cached: true,
      });
    }
  }

  const { payload, model, is_fallback } = await generateInsight(sql, a.ctx.clientId, q.month, base);

  await sql`
    INSERT INTO public.finance_ai_reports (client_id, month, payload, model, is_fallback, generated_at)
    VALUES (${a.ctx.clientId}::uuid, ${q.month}, ${JSON.stringify(payload)}::jsonb, ${model}, ${is_fallback}, now())
    ON CONFLICT (client_id, month) DO UPDATE
      SET payload = EXCLUDED.payload, model = EXCLUDED.model,
          is_fallback = EXCLUDED.is_fallback, generated_at = now()
  `;

  return jsonOk({
    month: q.month, base_currency: base, ...payload, model, is_fallback,
    generated_at: new Date().toISOString(), cached: false,
  });
}
