import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';

// POST   /api/marketing/webhook-triggers        — create event_type → campaign
// DELETE /api/marketing/webhook-triggers?id=...  — remove a trigger
// One function, both methods (no config.method).
export const config = { path: '/api/marketing/webhook-triggers' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.edit']);
  if (!a.ok) return a.res;
  const sql = db();

  if (req.method === 'POST') {
    const b = (await req.json().catch(() => ({}))) as { event_type?: string; campaign_id?: string };
    if (!b.event_type?.trim() || !b.campaign_id) return jsonError(400, 'invalid_input');
    // Campaign must belong to this tenant (prevents cross-tenant trigger binding).
    const camp = (await sql`SELECT id FROM public.marketing_campaigns WHERE id = ${b.campaign_id}::uuid AND client_id = ${a.ctx.clientId}::uuid`) as Array<{ id: string }>;
    if (!camp[0]) return jsonError(404, 'campaign_not_found');
    const rows = (await sql`
      INSERT INTO public.marketing_webhook_triggers (client_id, event_type, campaign_id)
      VALUES (${a.ctx.clientId}::uuid, ${b.event_type.trim()}, ${b.campaign_id}::uuid)
      RETURNING id, event_type, campaign_id, active, created_at
    `) as any[];
    return new Response(JSON.stringify({ trigger: rows[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (req.method === 'DELETE') {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return jsonError(400, 'invalid_input');
    await sql`DELETE FROM public.marketing_webhook_triggers WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid`;
    return new Response(null, { status: 204 });
  }

  return jsonError(405, 'method_not_allowed');
}
