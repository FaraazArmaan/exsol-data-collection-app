// GET /api/public/sales/:saleUuid — public storefront receipt (spec §5.3).
//
// The sale UUID is the bearer token. Two conditions are BOTH required:
// id match AND source='storefront' — so a v1 in-store sale UUID returns 404
// (leak guard, never reveals a staff sale to a guest). No storefront_enabled
// check here: a receipt keeps working even if the tenant later turns the
// storefront off (bearer-token kindness). Returns the whitelisted shape only.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { checkLimit, clientIp } from './_pub-ratelimit';
import { serializePublicSale, type SaleRow, type SaleLineRow } from './_pub-serialize';

export const config = { path: '/api/public/sales/:saleUuid', method: 'GET' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string {
  const segs = new URL(req.url).pathname.split('/').filter(Boolean);
  return decodeURIComponent(segs[segs.length - 1] ?? '');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const rl = await checkLimit(clientIp(req), 'detail', { perMinute: 60 });
  if (!rl.ok) return jsonError(429, rl.code);

  const id = idFromUrl(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  const sql = db();
  const sales = (await sql`
    SELECT * FROM public.sales WHERE id = ${id}::uuid AND source = 'storefront'
  `) as SaleRow[];
  if (!sales[0]) return jsonError(404, 'not_found');

  const lines = (await sql`
    SELECT * FROM public.sale_lines WHERE sale_id = ${id}::uuid ORDER BY position
  `) as SaleLineRow[];

  return jsonOk(serializePublicSale(sales[0], lines));
}
