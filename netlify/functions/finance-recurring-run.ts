// POST /api/finance/recurring-run — materialize this client's due templates now.
// Lets an Owner catch up recurring/milestone expenses without waiting for the
// nightly cron (and makes the behaviour demoable). Scoped to the caller's client.
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { materializeDueTemplates } from './_finance-recurring';

export const config = { path: '/api/finance/recurring-run', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireFinance(req, ['finance.business.create']);
  if (!a.ok) return a.res;
  const materialized = await materializeDueTemplates(db(), { clientId: a.ctx.clientId });
  return jsonOk({ materialized });
}
