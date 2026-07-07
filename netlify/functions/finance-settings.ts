// GET/PUT /api/finance/settings — per-client finance settings (approval
// threshold). GET returns the threshold + base currency for the UI; PUT upserts
// the threshold (finance.business.edit). Threshold is base-currency minor units.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { SettingsUpdate } from './_finance-validators';
import { fetchBaseCurrency } from './_finance-fx';
import { fetchThreshold } from './_finance-settings';

export const config = { path: '/api/finance/settings', method: ['GET', 'PUT'] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireFinance(req, ['finance.business.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const [threshold, base_currency] = await Promise.all([
      fetchThreshold(sql, a.ctx.clientId),
      fetchBaseCurrency(sql, a.ctx.clientId),
    ]);
    return jsonOk({ approval_threshold_cents: threshold, base_currency });
  }

  if (req.method === 'PUT') {
    const a = await requireFinance(req, ['finance.business.edit']);
    if (!a.ok) return a.res;
    let body: SettingsUpdate;
    try {
      body = SettingsUpdate.parse(await req.json());
    } catch (e: any) {
      return jsonError(400, 'invalid_body', { issues: e?.issues });
    }
    const sql = db();
    await sql`
      INSERT INTO public.finance_settings (client_id, approval_threshold_cents, updated_at)
      VALUES (${a.ctx.clientId}::uuid, ${body.approval_threshold_cents}, now())
      ON CONFLICT (client_id) DO UPDATE
        SET approval_threshold_cents = EXCLUDED.approval_threshold_cents, updated_at = now()
    `;
    return jsonOk({ approval_threshold_cents: body.approval_threshold_cents });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
