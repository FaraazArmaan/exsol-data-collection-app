import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';

export const config = { path: '/api/crm/customers', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireCrm(req, ['crm.customers.view']);
  if (!a.ok) return a.res;
  const sql = db();
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  const like = `%${q}%`;
  const rows = q
    ? await sql`SELECT id, display_name, phone, email, source, first_seen, last_seen
                FROM public.crm_customers WHERE client_id = ${a.ctx.clientId}::uuid
                AND (display_name ILIKE ${like} OR phone ILIKE ${like} OR email ILIKE ${like})
                ORDER BY last_seen DESC LIMIT 500`
    : await sql`SELECT id, display_name, phone, email, source, first_seen, last_seen
                FROM public.crm_customers WHERE client_id = ${a.ctx.clientId}::uuid
                ORDER BY last_seen DESC LIMIT 500`;
  return new Response(JSON.stringify({ customers: rows }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
