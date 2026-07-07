// POST /api/public/reviews — public storefront review / question submission.
//
// Same defensive order as pub-sale-create: rate-limit → honeypot (silent 200) →
// validate → resolve slug → (optional) verify the product is this tenant's and
// storefront-visible → insert as status='pending'. Nothing is shown publicly
// until a staff member approves it, so this endpoint never returns other rows.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveStorefront } from './_pub-authz';
import { checkLimit, clientIp } from './_pub-ratelimit';
import { z } from 'zod';

export const config = { path: '/api/public/reviews', method: 'POST' };

const Body = z
  .object({
    slug: z.string().min(1).max(120),
    honeypot: z.string().max(0),
    productId: z.string().uuid().optional(),
    kind: z.enum(['review', 'question']),
    rating: z.number().int().min(1).max(5).optional(),
    authorName: z.string().trim().min(1).max(80),
    authorEmail: z.string().email().max(254).optional(),
    body: z.string().trim().min(1).max(4000),
  })
  .refine((b) => (b.kind === 'review' ? b.rating != null : b.rating == null), {
    message: 'reviews require a rating; questions must not have one',
    path: ['rating'],
  });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const slugHint = typeof raw?.slug === 'string' ? raw.slug : '';

  const rl = await checkLimit(clientIp(req), 'review', {
    perMinute: 6,
    perSlugIp: slugHint ? { slug: slugHint, per10min: 5 } : undefined,
  });
  if (!rl.ok) return jsonError(429, rl.code);

  // Honeypot before zod — a tripped bot gets a believable 200, no DB write.
  if (typeof raw?.honeypot === 'string' && raw.honeypot !== '') {
    return jsonOk({ id: crypto.randomUUID(), status: 'pending' }, { status: 200 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(raw);
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }

  const tenant = await resolveStorefront(body.slug);
  if (!tenant) return jsonError(404, 'storefront_unavailable');
  const sql = db();

  // If a product is named it must belong to this tenant and be storefront-visible
  // (don't let a stranger attach reviews to arbitrary product ids).
  if (body.productId) {
    const prod = (await sql`
      SELECT id FROM public.products
      WHERE id = ${body.productId}::uuid AND client_id = ${tenant.clientId}::uuid
        AND storefront_visible = true AND deleted_at IS NULL AND status = 'active'
    `) as Array<{ id: string }>;
    if (!prod[0]) return jsonError(400, 'product_not_visible');
  }

  const rows = (await sql`
    INSERT INTO public.product_reviews
      (client_id, product_id, kind, rating, author_name, author_email, body, status)
    VALUES (${tenant.clientId}::uuid, ${body.productId ?? null}, ${body.kind}, ${body.rating ?? null},
            ${body.authorName}, ${body.authorEmail ?? null}, ${body.body}, 'pending')
    RETURNING id
  `) as Array<{ id: string }>;

  return jsonOk({ id: rows[0]!.id, status: 'pending' }, { status: 201 });
}
