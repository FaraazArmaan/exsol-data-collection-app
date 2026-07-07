import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';

// GET  /api/marketing/gdpr/consent?email=... — consent history (view).
// POST /api/marketing/gdpr/consent { email, channel, granted, source } — record (edit).
export const config = { path: '/api/marketing/gdpr/consent' };

const CHANNELS = ['email', 'sms', 'whatsapp', 'all'];

export default async function handler(req: Request): Promise<Response> {
  const sql = db();

  if (req.method === 'GET') {
    const a = await requireMarketing(req, ['marketing.customers.view']);
    if (!a.ok) return a.res;
    const email = (new URL(req.url).searchParams.get('email') ?? '').trim();
    if (!email) return jsonError(400, 'invalid_input');
    const rows = await sql`
      SELECT id, email, channel, granted, source, created_at
      FROM public.marketing_consent_log
      WHERE client_id = ${a.ctx.clientId}::uuid AND lower(email) = ${email.toLowerCase()}
      ORDER BY created_at DESC
    `;
    return new Response(JSON.stringify({ consent: rows }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (req.method === 'POST') {
    const a = await requireMarketing(req, ['marketing.customers.edit']);
    if (!a.ok) return a.res;
    const b = (await req.json().catch(() => ({}))) as { email?: string; channel?: string; granted?: boolean; source?: string };
    const email = (b.email ?? '').trim();
    const channel = CHANNELS.includes(b.channel ?? '') ? b.channel : 'all';
    if (!email || typeof b.granted !== 'boolean') return jsonError(400, 'invalid_input');
    const rows = (await sql`
      INSERT INTO public.marketing_consent_log (client_id, email, channel, granted, source)
      VALUES (${a.ctx.clientId}::uuid, ${email}, ${channel}, ${b.granted}, ${b.source ?? 'manual'})
      RETURNING id, email, channel, granted, source, created_at
    `) as any[];
    return new Response(JSON.stringify({ consent: rows[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return jsonError(405, 'method_not_allowed');
}
