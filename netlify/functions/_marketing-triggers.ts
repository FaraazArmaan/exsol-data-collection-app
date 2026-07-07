import { randomUUID } from 'node:crypto';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { dispatch, type Channel } from '../../src/modules/marketing/lib/channels';
import { withOpenPixel } from '../../src/modules/marketing/lib/tracking';
import type { DeliveryResult } from './_shared/resend';

type Sql = NeonQueryFunction<false, false>;

// Pull a recipient contact out of a webhook payload. Integrations vary, so we
// probe the common field names rather than demand one schema.
export function recipientFromPayload(payload: unknown): { email: string | null; phone: string | null } {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const customer = (p.customer && typeof p.customer === 'object' ? p.customer : {}) as Record<string, unknown>;
  return {
    email: str(p.email) ?? str(p.recipient_email) ?? str(customer.email),
    phone: str(p.phone) ?? str(p.recipient_phone) ?? str(customer.phone),
  };
}

/**
 * Fire every active trigger matching (clientId, eventType): each sends its linked
 * campaign 1:1 to the payload's recipient. The campaign row is NOT flipped to
 * 'sent' — a trigger campaign is a reusable template. Returns the count fired.
 */
export async function fireTriggers(
  sql: Sql,
  clientId: string,
  eventType: string,
  payload: unknown,
  deps: { deliverEmail?: (m: { to: string; from: string; subject: string; html: string }) => Promise<DeliveryResult> } = {},
): Promise<number> {
  const triggers = (await sql`
    SELECT t.id, t.campaign_id, c.subject, c.subject_b, c.body_html, c.channel
    FROM public.marketing_webhook_triggers t
    JOIN public.marketing_campaigns c ON c.id = t.campaign_id AND c.client_id = t.client_id
    WHERE t.client_id = ${clientId}::uuid AND t.event_type = ${eventType} AND t.active = true
  `) as Array<{ id: string; campaign_id: string; subject: string; subject_b: string | null; body_html: string; channel: Channel }>;
  if (triggers.length === 0) return 0;

  const to = recipientFromPayload(payload);
  const from = process.env.MAIL_FROM ?? 'notifications@example.com';
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

  let fired = 0;
  for (const t of triggers) {
    const contact = t.channel === 'email' ? to.email : to.phone;
    if (!contact) continue; // payload didn't name a reachable recipient for this channel
    const sendId = randomUUID();
    const html = t.channel === 'email' ? withOpenPixel(t.body_html, sendId, baseUrl) : t.body_html;
    const res = await dispatch(t.channel, { to: contact, from, subject: t.subject, html }, deps);
    await sql`
      INSERT INTO public.campaign_sends (id, client_id, campaign_id, channel, recipient_email, recipient_phone, status, provider_id, error)
      VALUES (${sendId}::uuid, ${clientId}::uuid, ${t.campaign_id}::uuid, ${t.channel},
              ${t.channel === 'email' ? contact : null}, ${t.channel !== 'email' ? contact : null},
              ${res.status}, ${res.providerId ?? null}, ${res.error ?? null})
    `;
    fired++;
  }
  return fired;
}
