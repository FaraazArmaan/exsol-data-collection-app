// /api/files-detail/:id  — GET, PATCH, DELETE

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import {
  authenticateForPermission, ForbiddenError,
  type AnySession,
} from './_shared/permissions';
import { logAudit } from './_shared/audit';
import {
  TIER_VISIBILITY_CLAUSE, visibilityValues, resolveRoleId,
  isL1Owner, assertCanWrite,
} from './_shared/files-access';
import { isCategoryKey, MAX_CATEGORIES_PER_FILE } from '../../src/modules/files/shared/categories';
import { filesStore } from './_shared/files-storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/files-detail\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

const PatchBody = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5_000).nullable().optional(),
  categories: z.array(z.string()).max(MAX_CATEGORIES_PER_FILE).optional(),
  tier: z.enum(['public', 'role', 'restricted', 'confidential']).optional(),
  allowed_role_ids: z.array(z.string().uuid()).optional(),
  allowed_node_ids: z.array(z.string().uuid()).optional(),
  allowed_user_node_ids: z.array(z.string().uuid()).optional(),
});

interface VisibleFileResult {
  row: Record<string, unknown>;
  session: AnySession;
}

async function fetchVisibleFile(req: Request, permKey: string): Promise<VisibleFileResult | Response> {
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  const auth = await authenticateForPermission(req, permKey);
  if (auth instanceof Response) return auth;
  const session = auth;

  const sql = db();
  const roleId = await resolveRoleId(sql, session);
  const vv = visibilityValues(session, roleId);
  const clauses: string[] = ['files.id = $1::uuid'];
  const params: unknown[] = [id];
  if (!vv.skipClause) {
    params.push(vv.userNodeId);
    const ui = params.length;
    params.push(vv.roleId);
    const ri = params.length;
    clauses.push(
      TIER_VISIBILITY_CLAUSE.replaceAll('$1', `$${ui}`).replaceAll('$2', `$${ri}`),
    );
  }
  if (session.kind === 'admin') {
    clauses.push('files.client_id IS NULL');
  } else {
    params.push(session.client_id);
    clauses.push(`files.client_id = $${params.length}::uuid`);
  }
  const text = `SELECT * FROM public.files WHERE ${clauses.join(' AND ')} LIMIT 1`;
  const rows = (await (sql as unknown as (q: string, p: unknown[]) => Promise<Array<Record<string, unknown>>>)(text, params));
  if (rows.length === 0) return jsonError(404, 'not_found');
  return { row: rows[0]!, session };
}

async function handleGet(req: Request): Promise<Response> {
  const got = await fetchVisibleFile(req, '_platform.files.view');
  if (got instanceof Response) return got;
  const sql = db();
  const cats = (await sql`
    SELECT category_key FROM public.file_categories WHERE file_id = ${got.row.id as string}::uuid
  `) as { category_key: string }[];
  return jsonOk({ file: { ...got.row, categories: cats.map((c) => c.category_key) } });
}

async function handlePatch(req: Request): Promise<Response> {
  const got = await fetchVisibleFile(req, '_platform.files.edit');
  if (got instanceof Response) return got;
  const session = got.session;
  const sql = db();
  try { await assertCanWrite(sql, session); }
  catch (e) { if (e instanceof ForbiddenError) return jsonError(403, e.key); throw e; }

  const body = PatchBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'validation_failed', body.error.flatten());
  const d = body.data;

  if (d.categories) {
    for (const c of d.categories) if (!isCategoryKey(c)) return jsonError(400, 'unknown_category');
  }
  if (d.tier && (d.tier === 'restricted' || d.tier === 'confidential') && !isL1Owner(session)) {
    return jsonError(403, 'tier_requires_owner');
  }
  if (got.row.client_id === null && d.tier && d.tier !== 'public') {
    return jsonError(400, 'admin_vault_single_tier');
  }

  const file_id = got.row.id as string;
  const oldTier = got.row.tier as string;

  await sql`
    UPDATE public.files SET
      title = COALESCE(${d.title ?? null}, title),
      description = COALESCE(${d.description ?? null}, description),
      tier = COALESCE(${d.tier ?? null}::file_tier, tier),
      updated_at = now()
    WHERE id = ${file_id}::uuid
  `;
  if (d.categories) {
    await sql`DELETE FROM public.file_categories WHERE file_id = ${file_id}::uuid`;
    for (const c of d.categories) {
      await sql`INSERT INTO public.file_categories (file_id, category_key) VALUES (${file_id}::uuid, ${c})`;
    }
  }
  if (d.tier === 'role' && d.allowed_role_ids) {
    await sql`DELETE FROM public.file_allowed_roles WHERE file_id = ${file_id}::uuid`;
    for (const r of d.allowed_role_ids) {
      await sql`INSERT INTO public.file_allowed_roles (file_id, role_id) VALUES (${file_id}::uuid, ${r}::uuid)`;
    }
  }
  if (d.tier === 'restricted' && d.allowed_node_ids) {
    await sql`DELETE FROM public.file_allowed_nodes WHERE file_id = ${file_id}::uuid`;
    for (const n of d.allowed_node_ids) {
      await sql`INSERT INTO public.file_allowed_nodes (file_id, node_id) VALUES (${file_id}::uuid, ${n}::uuid)`;
    }
  }
  if (d.tier === 'confidential' && d.allowed_user_node_ids) {
    await sql`DELETE FROM public.file_allowed_users WHERE file_id = ${file_id}::uuid`;
    for (const u of d.allowed_user_node_ids) {
      await sql`INSERT INTO public.file_allowed_users (file_id, user_node_id) VALUES (${file_id}::uuid, ${u}::uuid)`;
    }
  }

  await logAudit(sql, {
    session,
    op: d.tier && d.tier !== oldTier ? 'files.tier_changed' : 'files.metadata_edited',
    clientId: (got.row.client_id as string | null) ?? null,
    targetType: 'file',
    targetId: file_id,
    detail: d.tier && d.tier !== oldTier
      ? { old_tier: oldTier, new_tier: d.tier }
      : { diff: { title: d.title ?? undefined, description: d.description ?? undefined, categories: d.categories } },
  });

  return jsonOk({ ok: true });
}

async function handleDelete(req: Request): Promise<Response> {
  const got = await fetchVisibleFile(req, '_platform.files.delete');
  if (got instanceof Response) return got;
  const session = got.session;
  const sql = db();
  try { await assertCanWrite(sql, session); }
  catch (e) { if (e instanceof ForbiddenError) return jsonError(403, e.key); throw e; }

  const file_id = got.row.id as string;
  const byte_size = got.row.byte_size as number | null;
  const isHard = new URL(req.url).searchParams.get('hard') === 'true';

  if (isHard) {
    const blob_key = got.row.blob_key as string | null;
    if (blob_key) {
      try { await filesStore().delete(blob_key); } catch (e) { console.error('[files] blob delete failed', e); }
    }
    await sql`DELETE FROM public.files WHERE id = ${file_id}::uuid`;
    await logAudit(sql, {
      session, op: 'files.deleted_hard',
      clientId: (got.row.client_id as string | null) ?? null,
      targetType: 'file', targetId: file_id, detail: { byte_size },
    });
  } else {
    await sql`UPDATE public.files SET deleted_at = now() WHERE id = ${file_id}::uuid`;
    await logAudit(sql, {
      session, op: 'files.deleted_soft',
      clientId: (got.row.client_id as string | null) ?? null,
      targetType: 'file', targetId: file_id, detail: null,
    });
  }

  return new Response(null, { status: 204 });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === 'GET')    return handleGet(req);
  if (req.method === 'PATCH')  return handlePatch(req);
  if (req.method === 'DELETE') return handleDelete(req);
  return jsonError(405, 'method_not_allowed');
};
