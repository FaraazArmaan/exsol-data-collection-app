// GET /api/crm/leads?status=new|converted|archived — the leads inbox (vendor).
// Returns the leads for the requested status (newest first) plus per-status
// counts for the tab badges.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';
import { LeadsQuery } from './_crm-validators';

export const config = { path: '/api/crm/leads', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const a = await requireCrm(req, ['crm.customers.view']);
  if (!a.ok) return a.res;

  let q: LeadsQuery;
  try { q = LeadsQuery.parse(Object.fromEntries(new URL(req.url).searchParams)); }
  catch (e: any) { return jsonError(400, 'invalid_query', { issues: e?.issues }); }

  const sql = db();
  const leads = (await sql`
    SELECT id, name, email, phone, message, source, status, converted_customer_id, created_at
    FROM public.crm_leads
    WHERE client_id = ${a.ctx.clientId}::uuid AND status = ${q.status}
    ORDER BY created_at DESC LIMIT 500
  `) as any[];

  const countRows = (await sql`
    SELECT status, COUNT(*)::int AS n FROM public.crm_leads
    WHERE client_id = ${a.ctx.clientId}::uuid GROUP BY status
  `) as Array<{ status: string; n: number }>;
  const counts: Record<string, number> = { new: 0, converted: 0, archived: 0 };
  for (const c of countRows) counts[c.status] = c.n;

  return jsonOk({ leads, counts });
}
