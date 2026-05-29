import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const CreateBody = z.object({
  level_number: z.number().int().positive(),
  label: z.string().min(1).max(100).optional(),
  allowed_role_ids: z.array(z.string().uuid()).default([]),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const clientId = new URL(req.url).searchParams.get('client');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();

  // Friendly default: if the request didn't supply allowed_role_ids (or sent
  // an empty array), pre-populate with ALL existing roles for this client.
  // Admin can toggle individual roles off via the chips in LevelEditor.
  let effectiveAllowedRoleIds = parsed.data.allowed_role_ids;
  if (effectiveAllowedRoleIds.length === 0) {
    const existing = (await sql`
      SELECT id FROM public.client_roles WHERE client_id = ${clientId}::uuid
    `) as { id: string }[];
    effectiveAllowedRoleIds = existing.map((r) => r.id);
  }

  try {
    const rows = (await sql`
      INSERT INTO public.client_levels (client_id, level_number, label, allowed_role_ids)
      VALUES (${clientId}::uuid, ${parsed.data.level_number},
              ${parsed.data.label ?? null}, ${effectiveAllowedRoleIds}::uuid[])
      RETURNING id, client_id, level_number, label, allowed_role_ids, created_at
    `) as unknown[];
    return jsonOk({ level: rows[0] }, { status: 201 });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') return jsonError(409, 'level_number_taken');
    if (code === '23503') return jsonError(404, 'client_not_found');
    throw e;
  }
};
