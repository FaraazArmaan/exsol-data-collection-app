import { randomUUID } from 'node:crypto';
import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';
import { reachableRecipients, type Audience } from '../../src/modules/marketing/lib/audience';
import { dispatch, channelContact, type Channel } from '../../src/modules/marketing/lib/channels';
import { assignVariant, withOpenPixel } from '../../src/modules/marketing/lib/tracking';
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
    RETURNING id, subject, subject_b, body_html, audience, channel, is_ab, ab_split
  `) as Array<{ id: string; subject: string; subject_b: string | null; body_html: string; audience: Audience; channel: Channel; is_ab: boolean; ab_split: number }>;
  if (!claimed[0]) {
    const exists = (await sql`SELECT id FROM public.marketing_campaigns WHERE id = ${b.campaign_id}::uuid AND client_id = ${a.ctx.clientId}::uuid`) as Array<{ id: string }>;
    if (!exists[0]) return jsonError(404, 'not_found');
    return jsonError(409, 'already_sent');
  }
  const c = claimed[0];

  const from = process.env.MAIL_FROM ?? 'notifications@example.com';
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  const contact = channelContact(c.channel); // 'email' | 'phone'
  const recipients = await reachableRecipients(sql, a.ctx.clientId, c.audience, c.channel);
  const byStatus = { sent: 0, logged: 0, failed: 0 };
  const byVariant = { A: 0, B: 0 };
  for (const r of recipients) {
    const sendId = randomUUID(); // app-side id so the open pixel can carry it before INSERT
    const to = contact === 'email' ? (r.email as string) : (r.phone as string);
    const variant = c.is_ab ? assignVariant(r.email ?? r.phone ?? sendId, c.ab_split) : null;
    if (variant) byVariant[variant]++;
    const subject = variant === 'B' ? (c.subject_b ?? c.subject) : c.subject;
    // Open pixel only makes sense on email (html). sms/whatsapp go out as-is.
    const html = c.channel === 'email' ? withOpenPixel(c.body_html, sendId, baseUrl) : c.body_html;
    try {
      const res = await dispatch(c.channel, { to, from, subject, html }, { deliverEmail: deliver });
      byStatus[res.status]++;
      await sql`
        INSERT INTO public.campaign_sends (id, client_id, campaign_id, customer_id, channel, variant, recipient_email, recipient_phone, status, provider_id, error)
        VALUES (${sendId}::uuid, ${a.ctx.clientId}::uuid, ${c.id}::uuid, ${r.id}::uuid, ${c.channel}, ${variant},
                ${contact === 'email' ? to : null}, ${contact === 'phone' ? to : null},
                ${res.status}, ${res.providerId ?? null}, ${res.error ?? null})
      `;
    } catch {
      byStatus.failed++;
    }
  }
  return new Response(JSON.stringify({ sent: recipients.length, channel: c.channel, byStatus, byVariant: c.is_ab ? byVariant : undefined }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
