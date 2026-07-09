import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { AdminCapabilityError, requireAdminCapability, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';

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

const PatchBody = z.object({
  label: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fields: z.array(FieldDef).optional(),
  sort_order: z.number().int().optional(),
  bucket_family: BucketFamily.nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'at_least_one_field_required' });

export default async (req: Request, _ctx: Context) => {
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  let actor;
  try { actor = await requireAdminCapability(req, 'permissions.manage'); } catch (e) {
    if (e instanceof AdminCapabilityError) return jsonError(403, 'admin_role_forbidden', { capability: e.capability });
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

    const fieldsJson = parsed.data.fields ? JSON.stringify(parsed.data.fields) : null;
    // bucket_family: undefined = no change; null = clear to NULL; string = set value
    const hasBucketFamily = 'bucket_family' in parsed.data;
    const bucketFamilyVal = hasBucketFamily ? (parsed.data.bucket_family ?? null) : undefined;
    const rows = (await sql`
      UPDATE public.client_roles
      SET label         = COALESCE(${parsed.data.label ?? null}::text, label),
          color         = COALESCE(${parsed.data.color ?? null}::text, color),
          fields        = COALESCE(${fieldsJson}::jsonb, fields),
          sort_order    = COALESCE(${parsed.data.sort_order ?? null}::int, sort_order),
          bucket_family = CASE WHEN ${hasBucketFamily}::boolean THEN ${bucketFamilyVal ?? null}::text ELSE bucket_family END
      WHERE id = ${id}::uuid
      RETURNING id, client_id, key, label, color, fields, sort_order, bucket_family, created_at, updated_at
    `) as Array<{ client_id: string }>;
    if (rows.length === 0) return jsonError(404, 'not_found');
    await logAudit(sql, {
      session: { kind: 'admin', admin: { id: actor.admin.id, email: '' } },
      op: 'role.updated',
      clientId: rows[0]!.client_id,
      targetType: 'role',
      targetId: id,
      detail: parsed.data,
    });
    return jsonOk({ role: rows[0] });
  }

  if (req.method === 'DELETE') {
    // Fetch row (need client_id + key for audit) before deletion.
    const existing = (await sql`
      SELECT client_id, key FROM public.client_roles WHERE id = ${id}::uuid LIMIT 1
    `) as { client_id: string; key: string }[];
    if (existing.length === 0) return jsonError(404, 'not_found');

    // Refuse if any user_node references this role.
    const refs = (await sql`SELECT 1 FROM public.user_nodes WHERE role_id = ${id}::uuid LIMIT 1`) as unknown[];
    if (refs.length > 0) return jsonError(409, 'role_in_use');
    const rows = (await sql`
      DELETE FROM public.client_roles WHERE id = ${id}::uuid RETURNING id
    `) as { id: string }[];
    if (rows.length === 0) return jsonError(404, 'not_found');
    await logAudit(sql, {
      session: { kind: 'admin', admin: { id: actor.admin.id, email: '' } },
      op: 'role.deleted',
      clientId: existing[0]!.client_id,
      targetType: 'role',
      targetId: id,
      detail: { key: existing[0]!.key },
    });
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
