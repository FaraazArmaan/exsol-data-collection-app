// POST /api/files-bulk — apply one action to many files in the caller's scope.
// Files outside scope are silently skipped (counted), never errored, to avoid
// cross-client existence disclosure.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import {
  authenticateForPermission, ForbiddenError,
  type AnySession,
} from './_shared/permissions';
import { assertCanWrite, isL1Owner } from './_shared/files-access';
import { recomputeUsage } from './_shared/files-quota';
import { isCategoryKey } from '../../src/modules/files/shared/categories';
import { logAudit } from './_shared/audit';

const FileIds = z.array(z.string().uuid()).min(1).max(500);

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('soft_delete'), file_ids: FileIds }),
  z.object({ action: z.literal('restore'),     file_ids: FileIds }),
  z.object({
    action: z.literal('change_tier'),
    file_ids: FileIds,
    tier: z.enum(['public', 'role', 'restricted', 'confidential']),
    allowed_role_ids: z.array(z.string().uuid()).optional().default([]),
    allowed_node_ids: z.array(z.string().uuid()).optional().default([]),
    allowed_user_node_ids: z.array(z.string().uuid()).optional().default([]),
  }),
  z.object({ action: z.literal('add_category'),    file_ids: FileIds, category: z.string() }),
  z.object({ action: z.literal('remove_category'), file_ids: FileIds, category: z.string() }),
]);

/** Returns the subset of file_ids that exist within the caller's writable scope. */
async function inScopeIds(
  sql: ReturnType<typeof db>, session: AnySession, fileIds: string[],
): Promise<string[]> {
  if (session.kind === 'admin') {
    const rows = (await sql`
      SELECT id FROM public.files
      WHERE id = ANY(${fileIds}::uuid[]) AND client_id IS NULL
    `) as { id: string }[];
    return rows.map((r) => r.id);
  }
  const rows = (await sql`
    SELECT id FROM public.files
    WHERE id = ANY(${fileIds}::uuid[]) AND client_id = ${session.client_id}::uuid
  `) as { id: string }[];
  return rows.map((r) => r.id);
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const payload = await req.json().catch(() => null);

  // Authenticate before validating the body so an unauthenticated caller always
  // gets 401 (never a 400 that would reveal the body was even inspected). The
  // permission is keyed off the requested action; an unrecognised action falls
  // back to the edit permission purely to gate identity — full validation below
  // still rejects it with 400 for authenticated callers.
  const rawAction = payload && typeof payload === 'object'
    ? (payload as { action?: unknown }).action
    : undefined;
  const permKey = rawAction === 'soft_delete' || rawAction === 'restore'
    ? '_platform.files.delete'
    : '_platform.files.edit';
  const auth = await authenticateForPermission(req, permKey);
  if (auth instanceof Response) return auth;
  const session = auth;

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    // Distinguish empty-list from other validation failures for the UI.
    if (payload && typeof payload === 'object' && Array.isArray((payload as { file_ids?: unknown }).file_ids)
        && (payload as { file_ids: unknown[] }).file_ids.length === 0) {
      return jsonError(400, 'bulk_empty');
    }
    return jsonError(400, 'bulk_action_invalid', parsed.error.flatten());
  }
  const body = parsed.data;

  // Bucket-user write block (external customers/employees) — admin & internal pass.
  const sql = db();
  try { await assertCanWrite(sql, session); }
  catch (e) { if (e instanceof ForbiddenError) return jsonError(403, e.key); throw e; }

  if (body.action === 'change_tier'
      && (body.tier === 'restricted' || body.tier === 'confidential')
      && !isL1Owner(session)) {
    return jsonError(403, 'tier_requires_owner');
  }
  if (body.action === 'add_category' || body.action === 'remove_category') {
    if (!isCategoryKey(body.category)) return jsonError(400, 'unknown_category');
  }

  // Admin vault is single-tier (public). Reject non-public bulk tier change there.
  if (session.kind === 'admin' && body.action === 'change_tier' && body.tier !== 'public') {
    return jsonError(400, 'admin_vault_single_tier');
  }

  const ids = await inScopeIds(sql, session, body.file_ids);
  let ok = 0;

  for (const id of ids) {
    switch (body.action) {
      case 'soft_delete':
        await sql`UPDATE public.files SET deleted_at = now() WHERE id = ${id}::uuid AND deleted_at IS NULL`;
        ok++; break;
      case 'restore':
        await sql`UPDATE public.files SET deleted_at = NULL WHERE id = ${id}::uuid`;
        ok++; break;
      case 'change_tier':
        await sql`UPDATE public.files SET tier = ${body.tier}::file_tier, updated_at = now() WHERE id = ${id}::uuid`;
        await sql`DELETE FROM public.file_allowed_roles WHERE file_id = ${id}::uuid`;
        await sql`DELETE FROM public.file_allowed_nodes WHERE file_id = ${id}::uuid`;
        await sql`DELETE FROM public.file_allowed_users WHERE file_id = ${id}::uuid`;
        if (body.tier === 'role') {
          for (const r of body.allowed_role_ids) {
            await sql`INSERT INTO public.file_allowed_roles (file_id, role_id) VALUES (${id}::uuid, ${r}::uuid) ON CONFLICT DO NOTHING`;
          }
        } else if (body.tier === 'restricted') {
          for (const n of body.allowed_node_ids) {
            await sql`INSERT INTO public.file_allowed_nodes (file_id, node_id) VALUES (${id}::uuid, ${n}::uuid) ON CONFLICT DO NOTHING`;
          }
        } else if (body.tier === 'confidential') {
          for (const u of body.allowed_user_node_ids) {
            await sql`INSERT INTO public.file_allowed_users (file_id, user_node_id) VALUES (${id}::uuid, ${u}::uuid) ON CONFLICT DO NOTHING`;
          }
        }
        ok++; break;
      case 'add_category':
        await sql`INSERT INTO public.file_categories (file_id, category_key) VALUES (${id}::uuid, ${body.category}) ON CONFLICT DO NOTHING`;
        ok++; break;
      case 'remove_category':
        await sql`DELETE FROM public.file_categories WHERE file_id = ${id}::uuid AND category_key = ${body.category}`;
        ok++; break;
    }
  }

  const skipped = body.file_ids.length - ids.length;

  // soft_delete/restore change usage; refresh the workspace cache.
  if (session.kind === 'bucket_user' && (body.action === 'soft_delete' || body.action === 'restore')) {
    await recomputeUsage(sql, session.client_id);
  }

  await logAudit(sql, {
    session, op: 'files.bulk_action',
    clientId: session.kind === 'bucket_user' ? session.client_id : null,
    targetType: 'file', targetId: null,
    detail: { action: body.action, file_ids: ids, result_counts: { ok, skipped } },
  });

  return jsonOk({ result_counts: { ok, skipped } });
};
