import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';
import { eraseCustomerData } from './_marketing-gdpr';

// POST /api/marketing/gdpr/erase { email } — anonymize a person across the tenant.
// Destructive → gated on customers.delete. The erasure-log row (who/what/counts)
// is the audit trail for this action.
export const config = { path: '/api/marketing/gdpr/erase', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.delete']);
  if (!a.ok) return a.res;
  const b = (await req.json().catch(() => ({}))) as { email?: string };
  const email = (b.email ?? '').trim();
  if (!email) return jsonError(400, 'invalid_input');

  const sql = db();
  const affected = await eraseCustomerData(sql, a.ctx.clientId, email);
  await sql`
    INSERT INTO public.marketing_erasure_log (client_id, email, requested_by_user_node, affected)
    VALUES (${a.ctx.clientId}::uuid, ${email}, ${a.ctx.userNodeId}::uuid, ${JSON.stringify(affected)}::jsonb)
  `;

  return new Response(JSON.stringify({ erased: true, email, affected }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
