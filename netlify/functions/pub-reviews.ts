// GET /api/public/reviews/:slug — approved reviews + Q&A for a storefront.
//
// Public read of status='approved' rows only. Optional ?productId scopes to one
// product. Returns reviews (with a rating summary) and questions (with any staff
// answer) separately so the storefront can lay them out independently.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveStorefront } from './_pub-authz';
import { checkLimit, clientIp } from './_pub-ratelimit';

export const config = { path: '/api/public/reviews/:slug', method: 'GET' };

interface Row {
  id: string;
  kind: string;
  rating: number | null;
  author_name: string;
  body: string;
  answer: string | null;
  product_id: string | null;
  product_name: string | null;
  created_at: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const url = new URL(req.url);
  const slug = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const productId = url.searchParams.get('productId');

  const rl = await checkLimit(clientIp(req), 'reviews-read', { perMinute: 60 });
  if (!rl.ok) return jsonError(429, rl.code);

  const tenant = await resolveStorefront(slug);
  if (!tenant) return jsonError(404, 'storefront_unavailable');
  const sql = db();

  const rows = (await sql`
    SELECT r.id, r.kind, r.rating, r.author_name, r.body, r.answer,
           r.product_id, p.name AS product_name, r.created_at
    FROM public.product_reviews r
    LEFT JOIN public.products p ON p.id = r.product_id
    WHERE r.client_id = ${tenant.clientId}::uuid
      AND r.status = 'approved'
      AND (${productId}::uuid IS NULL OR r.product_id = ${productId}::uuid)
    ORDER BY r.created_at DESC
    LIMIT 200
  `) as Row[];

  const reviews = rows.filter((r) => r.kind === 'review');
  const questions = rows.filter((r) => r.kind === 'question');
  const ratings = reviews.map((r) => Number(r.rating)).filter((n) => n > 0);
  const avgRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;

  const shape = (r: Row) => ({
    id: r.id,
    rating: r.rating == null ? null : Number(r.rating),
    authorName: r.author_name,
    body: r.body,
    answer: r.answer,
    productId: r.product_id,
    productName: r.product_name,
    createdAt: r.created_at,
  });

  return jsonOk({
    summary: { avgRating, reviewCount: reviews.length },
    reviews: reviews.map(shape),
    questions: questions.map(shape),
  });
}
