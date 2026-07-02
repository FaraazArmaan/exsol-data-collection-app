// The single sendMail({to, template, data}) seam every flow calls.
//
// Contract: sendMail NEVER throws into the caller — a mail failure must not
// break a booking or a sale. It writes the email_outbox row FIRST (audit is
// guaranteed even if delivery fails), then attempts delivery and reconciles
// the row status: sent (delivered) | logged (no API key, dev) | failed.
import { db } from './db';
import { loadBrandForEmail } from './brand-email';
import {
  renderBookingConfirmation, renderStorefrontReceipt,
  type BookingConfirmationData, type StorefrontReceiptData,
} from './email-templates';
import { deliver } from './resend';

export type MailTemplate = 'booking_confirmation' | 'storefront_receipt';

export type SendMailInput =
  | { clientId: string; to: string | null | undefined; template: 'booking_confirmation'; data: BookingConfirmationData }
  | { clientId: string; to: string | null | undefined; template: 'storefront_receipt'; data: StorefrontReceiptData };

export async function sendMail(input: SendMailInput): Promise<void> {
  try {
    const to = (input.to ?? '').trim();
    if (!to) return; // no recipient → nothing to send or audit

    const brand = await loadBrandForEmail(input.clientId);
    let subject: string;
    let html: string;
    let ics: string | undefined;
    if (input.template === 'booking_confirmation') {
      const r = renderBookingConfirmation(brand, input.data);
      subject = r.subject; html = r.html; ics = r.ics;
    } else {
      const r = renderStorefrontReceipt(brand, input.data);
      subject = r.subject; html = r.html;
    }

    const sql = db();
    // Row first — the outbox is the audit trail regardless of delivery outcome.
    const ins = (await sql`
      INSERT INTO public.email_outbox (client_id, to_email, template, subject, payload, body_html, status)
      VALUES (${input.clientId}::uuid, ${to}, ${input.template}, ${subject},
              ${JSON.stringify(input.data)}::jsonb, ${html}, 'pending')
      RETURNING id
    `) as Array<{ id: string }>;
    const id = ins[0]?.id;

    const from = process.env.MAIL_FROM || 'notifications@example.com';
    const attachments = ics ? [{ filename: 'invite.ics', content: ics }] : undefined;
    const res = await deliver({ to, from, subject, html, attachments });

    const status = res.delivered ? 'sent' : res.ok ? 'logged' : 'failed';
    if (status === 'failed') console.warn('[mailer] delivery failed:', res.error);
    else if (status === 'logged') console.info(`[mailer] no RESEND_API_KEY — logged ${input.template} to ${to}`);

    if (id) {
      await sql`
        UPDATE public.email_outbox
        SET status = ${status},
            provider_id = ${res.providerId ?? null},
            error = ${res.error ?? null},
            sent_at = ${status === 'sent' ? new Date().toISOString() : null}
        WHERE id = ${id}::uuid
      `;
    }
  } catch (e) {
    // Swallow — a mail failure must never fail the booking/sale that triggered it.
    console.error('[mailer] sendMail swallowed error:', (e as Error)?.message ?? e);
  }
}
