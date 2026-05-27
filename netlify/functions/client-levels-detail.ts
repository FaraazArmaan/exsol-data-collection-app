import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const PatchBody = z.object({
  label: z.string().min(1).max(100).optional(),
  allowed_role_ids: z.array(z.string().uuid()).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'at_least_one_field_required' });

export default async (req: Request, _ctx: Context) => {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(id, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const sql = db();

  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

    const rows = (await sql`
      UPDATE public.client_levels
      SET label            = COALESCE(${parsed.data.label ?? null}::text, label),
          allowed_role_ids = COALESCE(${parsed.data.allowed_role_ids ?? null}::uuid[], allowed_role_ids)
      WHERE id = ${id}::uuid
      RETURNING id, client_id, level_number, label, allowed_role_ids, created_at
    `) as unknown[];
    if (rows.length === 0) return jsonError(404, 'not_found');
    return jsonOk({ level: rows[0] });
  }

  if (req.method === 'DELETE') {
    // Look up level_number then refuse if any user_node sits at it.
    const lvls = (await sql`SELECT client_id, level_number FROM public.client_levels WHERE id = ${id}::uuid LIMIT 1`) as { client_id: string; level_number: number }[];
    if (lvls.length === 0) return jsonError(404, 'not_found');
    const refs = (await sql`
      SELECT 1 FROM public.user_nodes
      WHERE client_id = ${lvls[0]!.client_id}::uuid AND level_number = ${lvls[0]!.level_number}
      LIMIT 1
    `) as unknown[];
    if (refs.length > 0) return jsonError(409, 'level_in_use');
    await sql`DELETE FROM public.client_levels WHERE id = ${id}::uuid`;
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
