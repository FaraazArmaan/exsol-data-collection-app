// GET /api/pos/reviews?status=pending — staff moderation queue.
//
// Gated on pos.history.viewAll (manager tier — an L2 cashier with only
// history.view can't moderate; L1 Owner bypasses via requirePos). Frozen-key
// reuse per iron rule 3. Lists reviews/questions for the caller's client,
// newest first, filtered by status (default 'pending').

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requirePos } from './_pos-authz';

export const config = { path: '/api/pos/reviews' };

interface Row {
  id: string;
  kind: string;
  rating: number | null;
  author_name: string;
  author_email: string | null;
  body: string;
  answer: string | null;
  status: string;
  product_id: string | null;
  product_name: string | null;
  created_at: string;
  moderated_at: string | null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.history.viewAll']);
  if (!a.ok) return a.res;

  const status = new URL(req.url).searchParams.get('status') ?? 'pending';
  if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
    return jsonError(400, 'invalid_status');
  }
  const sql = db();

  const rows = (await sql`
    SELECT r.id, r.kind, r.rating, r.author_name, r.author_email, r.body, r.answer, r.status,
           r.product_id, p.name AS product_name, r.created_at, r.moderated_at
    FROM public.product_reviews r
    LEFT JOIN public.products p ON p.id = r.product_id
    WHERE r.client_id = ${a.ctx.clientId}::uuid
      AND (${status} = 'all' OR r.status = ${status})
    ORDER BY r.created_at DESC
    LIMIT 300
  `) as Row[];

  return jsonOk({
    reviews: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      rating: r.rating == null ? null : Number(r.rating),
      authorName: r.author_name,
      authorEmail: r.author_email,
      body: r.body,
      answer: r.answer,
      status: r.status,
      productId: r.product_id,
      productName: r.product_name,
      createdAt: r.created_at,
      moderatedAt: r.moderated_at,
    })),
  });
}
