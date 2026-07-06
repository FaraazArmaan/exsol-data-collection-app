import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';
import { jsonError } from './_shared/http';

export const config = { path: '/api/crm/customers/:id', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireCrm(req, ['crm.customers.view']);
  if (!a.ok) return a.res;
  const sql = db();
  const id = new URL(req.url).pathname.split('/').pop()!;
  const clientId = a.ctx.clientId;

  const rows = (await sql`SELECT * FROM public.crm_customers WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid`) as any[];
  const customer = rows[0];
  if (!customer) return jsonError(404, 'not_found');

  const notes = (await sql`SELECT id, body, created_by_user_node, created_at, updated_at
                           FROM public.crm_notes WHERE customer_id = ${id}::uuid AND client_id = ${clientId}::uuid
                           ORDER BY created_at DESC`) as any[];

  const email = customer.email;
  // crm_customers.phone is NORMALIZED (+91…) but sales/bookings store the RAW entered
  // phone — match on last 10 digits (strip non-digits) to bridge the two formats.
  // CAVEAT (v1, +91 single-country): matching on the last 10 digits can over-match two
  // customers who share a 10-digit tail under different country codes. Safe while normalizePhone
  // defaults to +91; revisit (match the full normalized phone) if multi-country is added.
  const phoneDigits = customer.phone ? String(customer.phone).replace(/\D/g, '').slice(-10) : null;

  const sales = (await sql`SELECT id, created_at AS when, order_no, total_cents, status
                           FROM public.sales
                           WHERE bucket_id = ${clientId}::uuid AND status IN ('paid','fulfilled')
                           AND ((${phoneDigits}::text IS NOT NULL AND right(regexp_replace(coalesce(customer_phone,''), '[^0-9]', '', 'g'), 10) = ${phoneDigits})
                                OR (${email}::text IS NOT NULL AND lower(customer_email) = ${email}))`) as any[];

  const bookings = (await sql`SELECT b.id, lower(b.time_range)::text AS when, b.price_cents, b.status, s.name AS service_name
                              FROM public.bookings b
                              LEFT JOIN public.booking_services s ON s.id = b.service_id
                              WHERE b.bucket_id = ${clientId}::uuid
                              AND ((${phoneDigits}::text IS NOT NULL AND right(regexp_replace(coalesce(b.customer_phone,''), '[^0-9]', '', 'g'), 10) = ${phoneDigits})
                                   OR (${email}::text IS NOT NULL AND lower(b.customer_email) = ${email}))`) as any[];

  const timeline = [
    ...sales.map((s: any) => ({ kind: 'sale' as const, id: s.id, when: s.when, label: `Order #${s.order_no}`, amount_cents: Number(s.total_cents), status: s.status })),
    ...bookings.map((b: any) => ({ kind: 'booking' as const, id: b.id, when: b.when, label: b.service_name ?? 'Booking', amount_cents: Number(b.price_cents), status: b.status })),
  ].sort((x, y) => new Date(y.when).getTime() - new Date(x.when).getTime());

  return new Response(JSON.stringify({ customer, notes, timeline }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
