// GET /api/public/config/:slug — storefront checkout config (tax + currency).
//
// Lets the details page show a live tax line and format money in the client's
// base currency. Advisory only — pub-sale-create recomputes tax authoritatively.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveStorefront } from './_pub-authz';
import { checkLimit, clientIp } from './_pub-ratelimit';

export const config = { path: '/api/public/config/:slug', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const slug = decodeURIComponent(new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '');
  const rl = await checkLimit(clientIp(req), 'config', { perMinute: 60 });
  if (!rl.ok) return jsonError(429, rl.code);

  const tenant = await resolveStorefront(slug);
  if (!tenant) return jsonError(404, 'storefront_unavailable');
  const sql = db();

  const rows = (await sql`
    SELECT c.base_currency,
           t.enabled, t.rate_bps, t.label, t.inclusive
    FROM public.clients c
    LEFT JOIN public.client_tax_config t ON t.client_id = c.id
    WHERE c.id = ${tenant.clientId}::uuid
  `) as Array<{
    base_currency: string | null;
    enabled: boolean | null; rate_bps: number | null; label: string | null; inclusive: boolean | null;
  }>;
  const r = rows[0];

  return jsonOk({
    currency: r?.base_currency ?? 'INR',
    tax: r?.enabled
      ? { enabled: true, rateBps: Number(r.rate_bps ?? 0), label: r.label ?? 'Tax', inclusive: !!r.inclusive }
      : { enabled: false, rateBps: 0, label: 'Tax', inclusive: false },
  });
}
