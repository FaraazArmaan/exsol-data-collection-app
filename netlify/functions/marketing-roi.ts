import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { roiForClient, roiTotals } from '../../src/modules/marketing/lib/attribution';

// GET /api/marketing/roi — per-campaign attributed revenue + rolled-up totals.
// Read-only projection over campaign data → gated on customers.view (DATA_BUCKETS
// is a closed union; marketing has no dedicated analytics bucket).
export const config = { path: '/api/marketing/roi', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.view']);
  if (!a.ok) return a.res;

  const rows = await roiForClient(db(), a.ctx.clientId);
  return new Response(JSON.stringify({ campaigns: rows, totals: roiTotals(rows) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
