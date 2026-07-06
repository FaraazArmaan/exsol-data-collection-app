import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';
import { audienceRecipients, type Audience } from '../../src/modules/marketing/lib/audience';
import { deliver } from './_shared/resend';

export const config = { path: '/api/marketing/send', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.edit']);
  if (!a.ok) return a.res;
  const b = (await req.json().catch(() => ({}))) as { campaign_id?: string };
  if (!b.campaign_id) return jsonError(400, 'invalid_input');
  const sql = db();

  // Atomically claim the draft → sent. Concurrent callers race here; only one wins.
  const claimed = (await sql`
    UPDATE public.marketing_campaigns SET status = 'sent', sent_at = now(), updated_at = now()
    WHERE id = ${b.campaign_id}::uuid AND client_id = ${a.ctx.clientId}::uuid AND status = 'draft'
    RETURNING id, subject, body_html, audience
  `) as Array<{ id: string; subject: string; body_html: string; audience: Audience }>;
  if (!claimed[0]) {
    // Either the campaign doesn't exist in this tenant, or it wasn't draft (already sent / lost the race).
    const exists = (await sql`SELECT id FROM public.marketing_campaigns WHERE id = ${b.campaign_id}::uuid AND client_id = ${a.ctx.clientId}::uuid`) as Array<{ id: string }>;
    if (!exists[0]) return jsonError(404, 'not_found');
    return jsonError(409, 'already_sent');
  }
  const c = claimed[0];

  const from = process.env.MAIL_FROM ?? 'notifications@example.com';
  const recipients = await audienceRecipients(sql, a.ctx.clientId, c.audience);
  const byStatus = { sent: 0, logged: 0, failed: 0 };
  for (const r of recipients) {
    try {
      const res = await deliver({ to: r.email, from, subject: c.subject, html: c.body_html });
      const status = res.delivered ? 'sent' : res.ok ? 'logged' : 'failed';
      byStatus[status as keyof typeof byStatus]++;
      await sql`
        INSERT INTO public.campaign_sends (client_id, campaign_id, customer_id, recipient_email, status, provider_id, error)
        VALUES (${a.ctx.clientId}::uuid, ${c.id}::uuid, ${r.id}::uuid, ${r.email}, ${status}, ${res.providerId ?? null}, ${res.error ?? null})
      `;
    } catch {
      byStatus.failed++;
    }
  }
  return new Response(JSON.stringify({ sent: recipients.length, byStatus }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
