// GET /api/crm/timeline/:id — one unified, chronological communication stream for
// a customer, merging: sales + bookings (matched by normalized-phone last-10 or
// lowercased email), crm_notes + campaign_sends (direct customer_id FK), and
// email_outbox (matched by to_email). Read-only; money BIGINT → Number().
// Distinct path from crm-customers/:id, so name-based routing hits this file.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';

export const config = { path: '/api/crm/timeline/:id', method: 'GET' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idFrom = (req: Request) => new URL(req.url).pathname.split('/').pop() ?? '';

const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  booking_confirmation: 'Booking confirmation email',
  storefront_receipt: 'Receipt email',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const a = await requireCrm(req, ['crm.customers.view']);
  if (!a.ok) return a.res;
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');
  const { clientId } = a.ctx;
  const sql = db();

  const custRows = (await sql`
    SELECT id, display_name, phone, email FROM public.crm_customers
    WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid LIMIT 1
  `) as Array<{ id: string; display_name: string; phone: string | null; email: string | null }>;
  const customer = custRows[0];
  if (!customer) return jsonError(404, 'not_found');

  const phoneDigits = customer.phone ? String(customer.phone).replace(/\D/g, '').slice(-10) : null;
  const email = customer.email;

  const sales = (await sql`
    SELECT id, created_at AS when, order_no, total_cents, status
    FROM public.sales
    WHERE bucket_id = ${clientId}::uuid AND status IN ('paid','fulfilled')
      AND ((${phoneDigits}::text IS NOT NULL AND right(regexp_replace(coalesce(customer_phone,''), '[^0-9]', '', 'g'), 10) = ${phoneDigits})
           OR (${email}::text IS NOT NULL AND lower(customer_email) = ${email}))
  `) as any[];

  const bookings = (await sql`
    SELECT b.id, lower(b.time_range)::text AS when, b.price_cents, b.status, s.name AS service_name
    FROM public.bookings b
    LEFT JOIN public.booking_services s ON s.id = b.service_id
    WHERE b.bucket_id = ${clientId}::uuid AND b.status IN ('confirmed','completed')
      AND ((${phoneDigits}::text IS NOT NULL AND right(regexp_replace(coalesce(b.customer_phone,''), '[^0-9]', '', 'g'), 10) = ${phoneDigits})
           OR (${email}::text IS NOT NULL AND lower(b.customer_email) = ${email}))
  `) as any[];

  const notes = (await sql`
    SELECT id, body, created_at AS when FROM public.crm_notes
    WHERE customer_id = ${id}::uuid AND client_id = ${clientId}::uuid
  `) as any[];

  const campaigns = (await sql`
    SELECT cs.id, cs.created_at AS when, cs.recipient_email, cs.status, mc.subject
    FROM public.campaign_sends cs
    LEFT JOIN public.marketing_campaigns mc ON mc.id = cs.campaign_id
    WHERE cs.customer_id = ${id}::uuid AND cs.client_id = ${clientId}::uuid
  `) as any[];

  // email_outbox has no customer FK — match on the customer's email only.
  const emails = email
    ? (await sql`
        SELECT id, created_at AS when, template, subject, status
        FROM public.email_outbox
        WHERE client_id = ${clientId}::uuid AND lower(to_email) = ${email}
      `) as any[]
    : [];

  const events = [
    ...sales.map((s) => ({
      kind: 'sale' as const, id: s.id, when: s.when,
      title: `Order #${s.order_no}`, subtitle: null,
      amount_cents: Number(s.total_cents), status: s.status, editable: false,
    })),
    ...bookings.map((b) => ({
      kind: 'booking' as const, id: b.id, when: b.when,
      title: b.service_name ?? 'Booking', subtitle: null,
      amount_cents: Number(b.price_cents), status: b.status, editable: false,
    })),
    ...notes.map((n) => ({
      kind: 'note' as const, id: n.id, when: n.when,
      title: 'Note', subtitle: n.body as string,
      amount_cents: null, status: null, editable: true,
    })),
    ...emails.map((e) => ({
      kind: 'email' as const, id: e.id, when: e.when,
      title: EMAIL_TEMPLATE_LABELS[e.template] ?? 'Email', subtitle: e.subject ?? null,
      amount_cents: null, status: e.status, editable: false,
    })),
    ...campaigns.map((c) => ({
      kind: 'campaign' as const, id: c.id, when: c.when,
      title: 'Marketing email', subtitle: c.subject ?? c.recipient_email ?? null,
      amount_cents: null, status: c.status, editable: false,
    })),
  ].sort((x, y) => new Date(y.when).getTime() - new Date(x.when).getTime());

  return jsonOk({ customer: { id: customer.id, display_name: customer.display_name }, events });
}
