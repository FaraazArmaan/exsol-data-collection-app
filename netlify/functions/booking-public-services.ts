// GET /api/booking-public/:slug/services — anonymous public service catalog.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';

export const config = { path: '/api/booking-public/:slug/services', method: 'GET' };

function slugFrom(req: Request): string {
  const p = new URL(req.url).pathname.split('/'); // .../booking-public/:slug/services
  return p[p.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const sql = db();
  const c = (await sql`SELECT id FROM public.clients WHERE slug = ${slugFrom(req)} LIMIT 1`) as Array<{ id: string }>;
  if (!c[0]) return jsonError(404, 'tenant_not_found');
  const services = (await sql`
    SELECT id, name, duration_min, price_cents, payment_mode, deposit_cents
    FROM public.booking_services WHERE bucket_id = ${c[0].id}::uuid AND active = true ORDER BY name
  `) as any[];
  return jsonOk({ services });
}
