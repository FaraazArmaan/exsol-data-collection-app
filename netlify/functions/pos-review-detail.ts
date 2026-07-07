// PATCH /api/pos/reviews/:id — moderate a review/question.
//
// Sets status (approved|rejected) and/or attaches a staff `answer` (for
// questions). Stamps moderated_at whenever status changes. Gated on
// pos.history.viewAll (manager tier), scoped to the caller's client.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requirePos } from './_pos-authz';
import { z } from 'zod';

export const config = { path: '/api/pos/reviews/:id' };

const Body = z
  .object({
    status: z.enum(['approved', 'rejected']).optional(),
    answer: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((b) => b.status !== undefined || b.answer !== undefined, {
    message: 'nothing to update',
  });

function idFromPath(req: Request): string | null {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 1];
  return id && id !== 'reviews' ? id : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'PATCH') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.history.viewAll']);
  if (!a.ok) return a.res;
  const id = idFromPath(req);
  if (!id) return jsonError(400, 'missing_id');

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }
  const sql = db();

  const cur = (await sql`
    SELECT status, answer, moderated_at FROM public.product_reviews
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `) as Array<{ status: string; answer: string | null; moderated_at: string | null }>;
  if (!cur[0]) return jsonError(404, 'review_not_found');

  const status = body.status ?? cur[0].status;
  const answer = body.answer === undefined ? cur[0].answer : body.answer;
  const moderatedChanged = body.status !== undefined && body.status !== cur[0].status;
  const moderatedAt = moderatedChanged ? new Date().toISOString() : cur[0].moderated_at;

  const rows = (await sql`
    UPDATE public.product_reviews SET
      status = ${status},
      answer = ${answer},
      moderated_at = ${moderatedAt}
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id
  `) as Array<{ id: string }>;
  if (!rows[0]) return jsonError(404, 'review_not_found');
  return jsonOk({ id: rows[0].id });
}
