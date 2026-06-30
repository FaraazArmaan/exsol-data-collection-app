// GET /api/booking-public/:slug/resources — anonymous list of active resources (names only).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';

export const config = { path: '/api/booking-public/:slug/resources', method: 'GET' };

function slugFrom(req: Request): string {
  const p = new URL(req.url).pathname.split('/');
  return p[p.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const sql = db();
  const c = (await sql`SELECT id FROM public.clients WHERE slug = ${slugFrom(req)} LIMIT 1`) as Array<{ id: string }>;
  if (!c[0]) return jsonError(404, 'tenant_not_found');
  const resources = (await sql`
    SELECT id, name FROM public.booking_resources WHERE bucket_id = ${c[0].id}::uuid AND active = true ORDER BY name
  `) as any[];
  return jsonOk({ resources });
}
