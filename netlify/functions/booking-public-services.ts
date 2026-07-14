// GET /api/booking-public/:slug/services — anonymous public service catalog.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolvePublicBooking } from './_booking-public';

export const config = { path: '/api/booking-public/:slug/services', method: 'GET' };

function slugFrom(req: Request): string {
  const p = new URL(req.url).pathname.split('/'); // .../booking-public/:slug/services
  return p[p.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const tenant = await resolvePublicBooking(slugFrom(req));
  if (!tenant) return jsonError(404, 'booking_unavailable');
  const sql = db();
  const services = (await sql`
    SELECT id, name, duration_min, price_cents, payment_mode, deposit_cents
    FROM public.booking_services WHERE bucket_id = ${tenant.clientId}::uuid AND active = true ORDER BY name
  `) as any[];
  return jsonOk({ services });
}
