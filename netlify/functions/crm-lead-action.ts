// POST /api/crm/lead-action/:id — convert a lead to a customer, or archive it.
// convert needs crm.customers.create (it materializes a crm_customer, deduped on
// the read-model key); archive needs crm.customers.edit. Only a 'new' lead can be
// acted on (else 409). Client-scoped so a cross-tenant id is 404.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';
import { LeadAction } from './_crm-validators';
import { upsertCustomerFromLead } from './_crm-public';

export const config = { path: '/api/crm/lead-action/:id', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idFrom = (req: Request) => new URL(req.url).pathname.split('/').pop() ?? '';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  let body: LeadAction;
  try { body = LeadAction.parse(await req.json()); }
  catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }

  const needed = body.action === 'convert' ? 'crm.customers.create' : 'crm.customers.edit';
  const a = await requireCrm(req, [needed]);
  if (!a.ok) return a.res;

  const sql = db();
  const rows = (await sql`
    SELECT id, name, email, phone, status FROM public.crm_leads
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as Array<{ id: string; name: string; email: string | null; phone: string | null; status: string }>;
  const lead = rows[0];
  if (!lead) return jsonError(404, 'not_found');
  if (lead.status !== 'new') return jsonError(409, `already_${lead.status}`);

  if (body.action === 'archive') {
    await sql`UPDATE public.crm_leads SET status = 'archived', updated_at = now()
              WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid`;
    return jsonOk({ id, status: 'archived' });
  }

  // convert
  const customerId = await upsertCustomerFromLead(sql, a.ctx.clientId, {
    name: lead.name, email: lead.email, phone: lead.phone,
  });
  if (!customerId) return jsonError(400, 'no_contact');
  await sql`
    UPDATE public.crm_leads SET status = 'converted', converted_customer_id = ${customerId}::uuid, updated_at = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `;
  return jsonOk({ id, status: 'converted', customer_id: customerId });
}
