import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const FieldDef = z.object({
  key: z.string().min(1).max(63).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  type: z.enum(['text', 'date', 'integer', 'boolean']),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  help: z.string().max(500).optional(),
  display_in_list: z.boolean().optional(),
});

const CreateBody = z.object({
  key: z.string().min(1).max(63).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fields: z.array(FieldDef).optional(),
  sort_order: z.number().int().optional(),
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
  try {
    const rows = (await sql`
      INSERT INTO public.client_roles (client_id, key, label, color, fields, sort_order)
      VALUES (
        ${clientId}::uuid,
        ${parsed.data.key},
        ${parsed.data.label},
        ${parsed.data.color},
        ${JSON.stringify(parsed.data.fields ?? [])}::jsonb,
        ${parsed.data.sort_order ?? 0}
      )
      RETURNING id, client_id, key, label, color, fields, sort_order, created_at, updated_at
    `) as { id: string }[];
    const role = rows[0]!;

    // Friendly default: a new role is auto-added to every existing level's
    // allowed_role_ids. Admin can opt-out by toggling the chip in LevelEditor.
    // array_append is idempotent vs duplicate ids; the safeguard is the WHERE
    // clause ensuring we don't double-append if the id is somehow already in.
    await sql`
      UPDATE public.client_levels
      SET allowed_role_ids = array_append(allowed_role_ids, ${role.id}::uuid)
      WHERE client_id = ${clientId}::uuid
        AND NOT (${role.id}::uuid = ANY(allowed_role_ids))
    `;

    return jsonOk({ role }, { status: 201 });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') return jsonError(409, 'role_key_taken');
    if (code === '23503') return jsonError(404, 'client_not_found');
    throw e;
  }
};
