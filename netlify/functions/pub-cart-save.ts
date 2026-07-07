// POST /api/public/cart — persist a guest cart snapshot for abandoned-cart email.
//
// Called from the storefront details page once the guest supplies an email.
// Upsert keyed by (client_id, session_key); server snapshots names + prices so
// the reminder email doesn't trust the client. A completed sale later flips this
// row to 'converted' (pub-sale-create), and the cron sweeps stale 'active' rows.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveStorefront } from './_pub-authz';
import { checkLimit, clientIp } from './_pub-ratelimit';
import { z } from 'zod';

export const config = { path: '/api/public/cart', method: 'POST' };

const Body = z.object({
  slug: z.string().min(1).max(120),
  sessionKey: z.string().min(8).max(64),
  channel: z.enum(['online', 'pickup']).optional(),
  customer: z.object({
    name: z.string().trim().max(120).optional(),
    email: z.string().email().max(254),
  }),
  lines: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().positive().max(99) })).min(1).max(50),
});

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const slugHint = typeof raw?.slug === 'string' ? raw.slug : '';
  const rl = await checkLimit(clientIp(req), 'cart', { perMinute: 20, perSlugIp: slugHint ? { slug: slugHint, per10min: 20 } : undefined });
  if (!rl.ok) return jsonError(429, rl.code);

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(raw);
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }

  const tenant = await resolveStorefront(body.slug);
  if (!tenant) return jsonError(404, 'storefront_unavailable');
  const sql = db();

  // Snapshot server prices for the visible products; silently drop any that
  // aren't this tenant's visible catalog.
  const ids = body.lines.map((l) => l.productId);
  const rows = (await sql`
    SELECT id, name, COALESCE(sale_price_cents, price_cents)::bigint AS unit_price_cents
    FROM public.products
    WHERE id = ANY(${ids}::uuid[]) AND client_id = ${tenant.clientId}::uuid
      AND storefront_visible = true AND deleted_at IS NULL AND status = 'active'
  `) as Array<{ id: string; name: string; unit_price_cents: number | string }>;
  const byId = new Map(rows.map((r) => [r.id, r]));

  let subtotal = 0;
  const snap = body.lines
    .filter((l) => byId.has(l.productId))
    .map((l) => {
      const p = byId.get(l.productId)!;
      const unit = Number(p.unit_price_cents);
      subtotal += unit * l.qty;
      return { productId: l.productId, name: p.name, qty: l.qty, unitPriceCents: unit };
    });
  if (snap.length === 0) return jsonOk({ ok: true, stored: false });

  await sql`
    INSERT INTO public.abandoned_carts
      (client_id, session_key, customer_name, customer_email, channel, lines, subtotal_cents, status)
    VALUES (${tenant.clientId}::uuid, ${body.sessionKey}, ${body.customer.name ?? null}, ${body.customer.email},
            ${body.channel ?? null}, ${JSON.stringify(snap)}::jsonb, ${subtotal}, 'active')
    ON CONFLICT (client_id, session_key) DO UPDATE SET
      customer_name = EXCLUDED.customer_name,
      customer_email = EXCLUDED.customer_email,
      channel = EXCLUDED.channel,
      lines = EXCLUDED.lines,
      subtotal_cents = EXCLUDED.subtotal_cents,
      status = CASE WHEN public.abandoned_carts.status = 'converted' THEN 'converted' ELSE 'active' END
  `;
  return jsonOk({ ok: true, stored: true });
}
