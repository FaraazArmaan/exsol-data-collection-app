import { randomUUID, randomBytes } from 'node:crypto';
import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';

// GET  /api/marketing/webhooks — endpoints (no secret), triggers, recent events.
// POST /api/marketing/webhooks — create an endpoint; secret returned ONCE.
// One function serves both methods (no config.method) → branch on req.method.
export const config = { path: '/api/marketing/webhooks' };

export default async function handler(req: Request): Promise<Response> {
  const sql = db();

  if (req.method === 'GET') {
    const a = await requireMarketing(req, ['marketing.customers.view']);
    if (!a.ok) return a.res;
    const cid = a.ctx.clientId;
    const [endpoints, triggers, events] = await Promise.all([
      sql`SELECT id, label, token, active, created_at FROM public.marketing_webhook_endpoints WHERE client_id = ${cid}::uuid ORDER BY created_at DESC`,
      sql`SELECT t.id, t.event_type, t.campaign_id, t.active, c.name AS campaign_name
          FROM public.marketing_webhook_triggers t
          JOIN public.marketing_campaigns c ON c.id = t.campaign_id
          WHERE t.client_id = ${cid}::uuid ORDER BY t.created_at DESC`,
      sql`SELECT id, event_type, triggered_count, created_at FROM public.marketing_webhook_events WHERE client_id = ${cid}::uuid ORDER BY created_at DESC LIMIT 20`,
    ]);
    return new Response(JSON.stringify({ endpoints, triggers, events }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (req.method === 'POST') {
    const a = await requireMarketing(req, ['marketing.customers.edit']);
    if (!a.ok) return a.res;
    const b = (await req.json().catch(() => ({}))) as { label?: string };
    if (!b.label?.trim()) return jsonError(400, 'invalid_input');
    const token = randomUUID().replace(/-/g, '');
    const secret = randomBytes(24).toString('hex');
    const rows = (await sql`
      INSERT INTO public.marketing_webhook_endpoints (client_id, label, token, secret)
      VALUES (${a.ctx.clientId}::uuid, ${b.label.trim()}, ${token}, ${secret})
      RETURNING id, label, token, active, created_at
    `) as any[];
    // secret is returned ONCE here and never again (only its HMAC use persists).
    return new Response(JSON.stringify({ endpoint: rows[0], secret }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return jsonError(405, 'method_not_allowed');
}
