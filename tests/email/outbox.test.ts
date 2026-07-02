// Integration: GET /api/email/outbox authz + listing. Reuses the booking
// helpers — enableBooking() turns on the saloon-booking product, which now
// bundles the email module, so the email enable-gate passes.
import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/email-outbox';
import {
  seedClientWithBooking, enableBooking, bookingRequest, sqlClient, demoteToL2,
} from '../booking/_helpers';

const sql = sqlClient();

async function seedOutboxRow(
  clientId: string, over: { template?: string; status?: string; to?: string } = {},
): Promise<void> {
  await sql`
    INSERT INTO public.email_outbox (client_id, to_email, template, subject, payload, body_html, status)
    VALUES (${clientId}, ${over.to ?? 'guest@example.test'}, ${over.template ?? 'booking_confirmation'},
            'Test subject', '{}'::jsonb, '<p>hi</p>', ${over.status ?? 'sent'})
  `;
}

describe('GET /api/email/outbox', () => {
  it('401 without a session', async () => {
    const res = await handler(new Request('http://localhost/api/email/outbox', { method: 'GET' }));
    expect(res.status).toBe(401);
  });

  it('412 when the email module is not enabled (even for the Owner)', async () => {
    const ctx = await seedClientWithBooking(); // no product enabled
    const res = await handler(bookingRequest(ctx, 'GET', '/api/email/outbox'));
    expect(res.status).toBe(412);
  });

  it('L1 Owner sees the client outbox when email is enabled', async () => {
    const ctx = await seedClientWithBooking();
    await enableBooking(ctx.clientId); // saloon-booking bundle includes email
    await seedOutboxRow(ctx.clientId, { status: 'sent', template: 'booking_confirmation' });
    await seedOutboxRow(ctx.clientId, { status: 'logged', template: 'storefront_receipt' });

    const res = await handler(bookingRequest(ctx, 'GET', '/api/email/outbox'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emails: Array<{ template: string; status: string; client_id?: string }> };
    expect(body.emails.length).toBeGreaterThanOrEqual(2);
    expect(body.emails.every((e) =>
      ['booking_confirmation', 'storefront_receipt'].includes(e.template))).toBe(true);
  });

  it('403 for an L2 without email.customers.view', async () => {
    const ctx = await seedClientWithBooking();
    await enableBooking(ctx.clientId);
    const l2 = await demoteToL2(ctx);
    const res = await handler(bookingRequest(l2, 'GET', '/api/email/outbox'));
    expect(res.status).toBe(403);
  });
});
