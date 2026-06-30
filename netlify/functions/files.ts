// /api/files
//   POST → commit metadata after a successful Blob PUT (or for URL externals)
//   GET  → list with filters + pagination

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import {
  authenticateForPermission, resolveClientIdOrRespond,
} from './_shared/permissions';
import { logAudit } from './_shared/audit';
import { classifyFileType } from './_shared/files-mime';
import { isAllowedBlobKeyShape, filesStore } from './_shared/files-storage';
import {
  TIER_VISIBILITY_CLAUSE, visibilityValues, resolveRoleId, isL1Owner,
} from './_shared/files-access';
import { isCategoryKey, MAX_CATEGORIES_PER_FILE } from '../../src/modules/files/shared/categories';
import { wouldExceed, recomputeUsage } from './_shared/files-quota';

// ---------- POST: commit ----------

const CommitBodyBase = z.object({
  title:       z.string().min(1).max(500),
  description: z.string().max(5_000).optional().nullable(),
  // +1 so we can detect overflow with our own error code instead of zod's generic message
  categories:  z.array(z.string()).max(MAX_CATEGORIES_PER_FILE + 1),
  folder_id:   z.string().uuid().optional().nullable(),
  tier:        z.enum(['public', 'role', 'restricted', 'confidential']).optional().default('public'),
  allowed_role_ids: z.array(z.string().uuid()).optional().default([]),
  allowed_node_ids: z.array(z.string().uuid()).optional().default([]),
  allowed_user_node_ids: z.array(z.string().uuid()).optional().default([]),
});

const BlobCommit = CommitBodyBase.extend({
  blob_key:  z.string(),
  mime:      z.string(),
  byte_size: z.number().int().nonnegative(),
  filename:  z.string().min(1).max(500),
});

const UrlCommit = CommitBodyBase.extend({
  external_url:      z.string().url(),
  external_provider: z.string().optional().nullable(),
});

const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);

async function handlePost(req: Request): Promise<Response> {
  const auth = await authenticateForPermission(req, '_platform.files.create');
  if (auth instanceof Response) return auth;
  const session = auth;

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return jsonError(400, 'validation_failed');

  const isBlob = 'blob_key' in (payload as object);
  const parsed = isBlob ? BlobCommit.safeParse(payload) : UrlCommit.safeParse(payload);
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const data = parsed.data;

  if (data.categories.length === 0) return jsonError(400, 'category_required');
  if (data.categories.length > MAX_CATEGORIES_PER_FILE) return jsonError(400, 'too_many_categories');
  for (const c of data.categories) {
    if (!isCategoryKey(c)) return jsonError(400, 'unknown_category', { category: c });
  }

  if ((data.tier === 'restricted' || data.tier === 'confidential') && !isL1Owner(session)) {
    return jsonError(403, 'tier_requires_owner');
  }

  let scope_client_id: string | null = null;
  if (session.kind === 'bucket_user') {
    const scope = resolveClientIdOrRespond(session, req);
    if (scope instanceof Response) return scope;
    scope_client_id = scope.clientId;
  } else if (data.tier !== 'public') {
    return jsonError(400, 'admin_vault_single_tier');
  }

  let storage_kind: 'blob' | 'url';
  let blob_key: string | null = null;
  let external_url: string | null = null;
  let external_provider: string | null = null;
  let mime: string | null = null;
  let byte_size: number | null = null;
  let filename: string | null = null;

  if (isBlob) {
    const d = data as z.infer<typeof BlobCommit>;
    if (!isAllowedBlobKeyShape(d.blob_key)) return jsonError(400, 'blob_key_invalid');
    const store = filesStore();
    let meta: Awaited<ReturnType<typeof store.getMetadata>> = null;
    try {
      meta = await store.getMetadata(d.blob_key);
    } catch {
      // treat any error as not-found
    }
    if (!meta) return jsonError(409, 'blob_not_found');
    storage_kind = 'blob';
    blob_key = d.blob_key;
    mime = d.mime;
    byte_size = d.byte_size;
    filename = d.filename;
  } else {
    const d = data as z.infer<typeof UrlCommit>;
    try {
      const parsed2 = new URL(d.external_url);
      if (!ALLOWED_URL_PROTOCOLS.has(parsed2.protocol)) return jsonError(400, 'url_scheme_blocked');
      external_url = d.external_url;
      external_provider = d.external_provider ?? null;
    } catch {
      return jsonError(400, 'url_invalid');
    }
    storage_kind = 'url';
  }

  const type = storage_kind === 'blob' ? classifyFileType(mime) : 'external';

  const sql = db();

  // Authoritative quota block for workspace blob uploads (URL externals carry no bytes).
  if (scope_client_id !== null && byte_size !== null) {
    if (await wouldExceed(sql, scope_client_id, byte_size)) {
      return jsonError(413, 'quota_exceeded');
    }
  }

  const inserted = (await sql`
    INSERT INTO public.files (
      client_id, type, storage_kind, blob_key, external_url, external_provider,
      title, description, filename, mime, byte_size, tier,
      uploaded_by_user_node, uploaded_by_admin
    )
    VALUES (
      ${scope_client_id}::uuid, ${type}, ${storage_kind}, ${blob_key}, ${external_url}, ${external_provider},
      ${data.title}, ${data.description ?? null}, ${filename}, ${mime}, ${byte_size}, ${data.tier},
      ${session.kind === 'bucket_user' ? session.user_node_id : null}::uuid,
      ${session.kind === 'admin' ? session.admin.id : null}::uuid
    )
    RETURNING *
  `) as Array<Record<string, unknown>>;
  const row = inserted[0]!;
  const file_id = row.id as string;

  for (const c of data.categories) {
    await sql`INSERT INTO public.file_categories (file_id, category_key) VALUES (${file_id}::uuid, ${c})`;
  }
  if (data.tier === 'role') {
    for (const r of data.allowed_role_ids) {
      await sql`INSERT INTO public.file_allowed_roles (file_id, role_id) VALUES (${file_id}::uuid, ${r}::uuid)`;
    }
  }
  if (data.tier === 'restricted') {
    for (const n of data.allowed_node_ids) {
      await sql`INSERT INTO public.file_allowed_nodes (file_id, node_id) VALUES (${file_id}::uuid, ${n}::uuid)`;
    }
  }
  if (data.tier === 'confidential') {
    for (const u of data.allowed_user_node_ids) {
      await sql`INSERT INTO public.file_allowed_users (file_id, user_node_id) VALUES (${file_id}::uuid, ${u}::uuid)`;
    }
  }

  await logAudit(sql, {
    session,
    op: 'files.uploaded',
    clientId: scope_client_id,
    targetType: 'file',
    targetId: file_id,
    detail: { type, byte_size, tier: data.tier, categories: data.categories },
  });

  if (scope_client_id !== null) {
    await recomputeUsage(sql, scope_client_id);
  }

  return jsonOk({ file: row }, { status: 201 });
}

// ---------- GET: list ----------

const ListQuery = z.object({
  type:     z.enum(['document', 'image', 'video', 'audio', 'external']).optional(),
  category: z.array(z.string()).optional(),
  tier:     z.enum(['public', 'role', 'restricted', 'confidential']).optional(),
  search:   z.string().max(200).optional(),
  sort:     z.enum(['newest', 'oldest', 'name', 'size']).optional().default('newest'),
  folder_id:     z.string().uuid().optional(),
  include_trash: z.string().optional(),
  limit:  z.coerce.number().int().positive().max(200).optional().default(50),
  cursor: z.string().optional(),
});

async function handleGet(req: Request): Promise<Response> {
  const auth = await authenticateForPermission(req, '_platform.files.view');
  if (auth instanceof Response) return auth;
  const session = auth;

  const url = new URL(req.url);
  const raw = {
    type:          url.searchParams.get('type') ?? undefined,
    category:      url.searchParams.getAll('category'),
    tier:          url.searchParams.get('tier') ?? undefined,
    search:        url.searchParams.get('search') ?? undefined,
    sort:          url.searchParams.get('sort') ?? undefined,
    folder_id:     url.searchParams.get('folder_id') ?? undefined,
    include_trash: url.searchParams.get('include_trash') ?? undefined,
    limit:         url.searchParams.get('limit') ?? undefined,
    cursor:        url.searchParams.get('cursor') ?? undefined,
  };
  const parsed = ListQuery.safeParse(raw);
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const q = parsed.data;

  let clientFilter: string | null = null;
  if (session.kind === 'bucket_user') {
    const scope = resolveClientIdOrRespond(session, req);
    if (scope instanceof Response) return scope;
    clientFilter = scope.clientId;
  }

  const sql = db();
  const roleId = await resolveRoleId(sql, session);
  const vv = visibilityValues(session, roleId);

  const clauses: string[] = ['files.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (clientFilter === null) {
    clauses.push('files.client_id IS NULL');
  } else {
    params.push(clientFilter);
    clauses.push(`files.client_id = $${params.length}::uuid`);
  }

  if (q.type) {
    params.push(q.type);
    clauses.push(`files.type = $${params.length}`);
  }
  if (q.tier) {
    params.push(q.tier);
    clauses.push(`files.tier = $${params.length}`);
  }
  if (q.search) {
    params.push(`%${q.search}%`);
    clauses.push(`(files.title ILIKE $${params.length} OR files.description ILIKE $${params.length})`);
  }
  if (q.category && q.category.length > 0) {
    const ph: string[] = [];
    for (const c of q.category) {
      if (!isCategoryKey(c)) continue;
      params.push(c);
      ph.push(`$${params.length}`);
    }
    if (ph.length > 0) {
      clauses.push(
        `EXISTS (SELECT 1 FROM public.file_categories fc WHERE fc.file_id = files.id AND fc.category_key IN (${ph.join(',')}))`,
      );
    }
  }

  if (!vv.skipClause) {
    params.push(vv.userNodeId);
    const userNodeOffset = params.length; // 1-based position of userNodeId
    params.push(vv.roleId);
    const roleOffset = params.length;     // 1-based position of roleId
    const tierClause = TIER_VISIBILITY_CLAUSE
      .replaceAll('$1', `$${userNodeOffset}`)
      .replaceAll('$2', `$${roleOffset}`);
    clauses.push(tierClause);
  }

  const orderBy =
    q.sort === 'oldest' ? 'files.created_at ASC, files.id ASC' :
    q.sort === 'name'   ? 'files.title ASC, files.id ASC' :
    q.sort === 'size'   ? 'files.byte_size DESC NULLS LAST, files.id DESC' :
                          'files.created_at DESC, files.id DESC';

  params.push(q.limit + 1);
  const sqlText = `
    SELECT files.* FROM public.files
    WHERE ${clauses.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT $${params.length}
  `;

  const rows = (await (sql as unknown as (s: string, p: unknown[]) => Promise<Array<Record<string, unknown>>>)(sqlText, params));
  const hasMore = rows.length > q.limit;
  const slice = rows.slice(0, q.limit);
  return jsonOk({
    files: slice,
    has_more: hasMore,
    next_cursor: hasMore ? String((slice.at(-1) as Record<string, unknown>).created_at) : null,
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === 'POST') return handlePost(req);
  if (req.method === 'GET')  return handleGet(req);
  return jsonError(405, 'method_not_allowed');
};
