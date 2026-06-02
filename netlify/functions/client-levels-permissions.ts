// netlify/functions/client-levels-permissions.ts
//
// GET ?id=<level_id> → {
//   permissions: Record<PermissionKey, true>,
//   module_rows: Array<{ module_key, label, bucket, verbs: Verb[] }>,
//   platform_rows: Array<{ surface, verbs: Verb[] }>,
// }
// PUT ?id=<level_id> body { permissions: Record<PermissionKey, true> }
//   → replaces the whole matrix; validates every key.
//
// L1 (Primary) is conceptually always all-on and rejects PUT with 409.
// Auth: admin only for now. Phase C migrates this to requirePermission
// once the middleware exists.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { isValidPermissionKey } from './_shared/permission-keys';
import {
  VERBS, PLATFORM_SURFACES, type Verb, type PlatformSurface,
} from '../../src/modules/registry/types';
import { derivePermissionRows } from '../../src/modules/registry/products';

const PutBody = z.object({
  permissions: z.record(z.literal(true)),
});

type LevelRow = { id: string; client_id: string; level_number: number; permissions: Record<string, true> };

export default async (req: Request, _ctx: Context) => {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const levelId = url.searchParams.get('id');
  if (!levelId) return jsonError(400, 'validation_failed', 'id required');
  try { assertUuid(levelId, 'id'); } catch { return jsonError(400, 'validation_failed', 'id must be uuid'); }

  const sql = db();
  const levels = (await sql`
    SELECT id, client_id, level_number, permissions
    FROM public.client_levels WHERE id = ${levelId}::uuid LIMIT 1
  `) as LevelRow[];
  if (levels.length === 0) return jsonError(404, 'level_not_found');
  const level = levels[0]!;

  const enabledRows = (await sql`
    SELECT product_key FROM public.client_enabled_products
    WHERE client_id = ${level.client_id}::uuid
  `) as { product_key: string }[];
  const enabledKeys = enabledRows.map((r) => r.product_key);

  if (req.method === 'GET') {
    const moduleRows = derivePermissionRows(enabledKeys).map((r) => ({
      module_key: r.module.key,
      label: r.module.label,
      bucket: r.bucket,
      verbs: r.module.verbs as readonly Verb[],
    }));
    const platformRows = (PLATFORM_SURFACES as readonly PlatformSurface[]).map((s) => ({
      surface: s,
      verbs: VERBS as readonly Verb[],
    }));
    return jsonOk({
      level_id: level.id,
      level_number: level.level_number,
      permissions: level.permissions,
      module_rows: moduleRows,
      platform_rows: platformRows,
    });
  }

  if (req.method === 'PUT') {
    if (level.level_number === 1) return jsonError(409, 'primary_level_immutable');
    const parsed = PutBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    for (const key of Object.keys(parsed.data.permissions)) {
      if (!isValidPermissionKey(key, enabledKeys)) {
        return jsonError(400, 'invalid_permission_key', { key });
      }
    }
    await sql`
      UPDATE public.client_levels
      SET permissions = ${JSON.stringify(parsed.data.permissions)}::jsonb
      WHERE id = ${levelId}::uuid
    `;
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};
