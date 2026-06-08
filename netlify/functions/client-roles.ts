import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { logAudit } from './_shared/audit';

const FieldDef = z.object({
  key: z.string().min(1).max(63).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  type: z.enum(['text', 'date', 'integer', 'boolean']),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  help: z.string().max(500).optional(),
  display_in_list: z.boolean().optional(),
});

const BucketFamily = z.enum(['business', 'employees', 'customers', 'products']);

const CreateBody = z.object({
  key: z.string().min(1).max(63).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fields: z.array(FieldDef).optional(),
  sort_order: z.number().int().optional(),
  bucket_family: BucketFamily.optional(),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
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
      INSERT INTO public.client_roles (client_id, key, label, color, fields, sort_order, bucket_family)
      VALUES (
        ${clientId}::uuid,
        ${parsed.data.key},
        ${parsed.data.label},
        ${parsed.data.color},
        ${JSON.stringify(parsed.data.fields ?? [])}::jsonb,
        ${parsed.data.sort_order ?? 0},
        ${parsed.data.bucket_family ?? null}
      )
      RETURNING id, client_id, key, label, color, fields, sort_order, bucket_family, created_at, updated_at
    `) as { id: string }[];
    const role = rows[0]!;

    // Roles are orthogonal to levels after the 2026-06-08 decoupling refactor:
    // any role can be assigned at any level, so role creation no longer touches
    // client_levels. The allowed_role_ids column was dropped in migration 036.

    await logAudit(sql, {
      session: { kind: 'admin', admin: { id: actor.admin.id, email: '' } },
      op: 'role.created',
      clientId,
      targetType: 'role',
      targetId: role.id,
      detail: { key: parsed.data.key, label: parsed.data.label },
    });

    return jsonOk({ role }, { status: 201 });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') return jsonError(409, 'role_key_taken');
    if (code === '23503') return jsonError(404, 'client_not_found');
    throw e;
  }
};
