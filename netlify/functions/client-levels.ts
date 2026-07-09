import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { AdminCapabilityError, requireAdminCapability, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { logAudit } from './_shared/audit';
import { defaultPermissionsForLevel } from './_shared/level-permissions';
import { rejectCrossSiteMutation } from './_shared/csrf';

const CreateBody = z.object({
  level_number: z.number().int().positive(),
  label: z.string().min(1).max(100).optional(),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;
  let actor;
  try { actor = await requireAdminCapability(req, 'permissions.manage'); } catch (e) {
    if (e instanceof AdminCapabilityError) return jsonError(403, 'admin_role_forbidden', { capability: e.capability });
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
    // Fetch enabled product keys for this client.
    const products = (await sql`
      SELECT product_key FROM public.client_enabled_products
      WHERE client_id = ${clientId}::uuid
    `) as { product_key: string }[];
    const enabledProductKeys = products.map((p) => p.product_key);
    const permissions = defaultPermissionsForLevel(parsed.data.level_number, enabledProductKeys);

    const rows = (await sql`
      INSERT INTO public.client_levels (client_id, level_number, label, permissions)
      VALUES (${clientId}::uuid, ${parsed.data.level_number},
              ${parsed.data.label ?? null}, ${JSON.stringify(permissions)}::jsonb)
      RETURNING id, client_id, level_number, label, permissions, created_at
    `) as Array<{ id: string }>;
    await logAudit(sql, {
      session: { kind: 'admin', admin: { id: actor.admin.id, email: '' } },
      op: 'level.created',
      clientId,
      targetType: 'level',
      targetId: rows[0]!.id,
      detail: { level_number: parsed.data.level_number, label: parsed.data.label ?? null },
    });
    return jsonOk({ level: rows[0] }, { status: 201 });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') return jsonError(409, 'level_number_taken');
    if (code === '23503') return jsonError(404, 'client_not_found');
    throw e;
  }
};
