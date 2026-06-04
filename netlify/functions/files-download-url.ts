// POST /api/files-download-url
// Returns the bytes inline. Body: { file_id }.
// Phase A streams through the function (simple, portable).

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { authenticateForPermission } from './_shared/permissions';
import { TIER_VISIBILITY_CLAUSE, visibilityValues, resolveRoleId } from './_shared/files-access';
import { filesStore } from './_shared/files-storage';

const Body = z.object({ file_id: z.string().uuid() });

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const auth = await authenticateForPermission(req, '_platform.files.view');
  if (auth instanceof Response) return auth;
  const session = auth;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const sql = db();
  const roleId = await resolveRoleId(sql, session);
  const vv = visibilityValues(session, roleId);

  const clauses: string[] = ['files.id = $1::uuid'];
  const params: unknown[] = [parsed.data.file_id];
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
  const rows = (await (sql as unknown as (q: string, p: unknown[]) => Promise<Array<{ blob_key: string | null; mime: string | null; filename: string | null }>>)(
    `SELECT blob_key, mime, filename FROM public.files WHERE ${clauses.join(' AND ')} LIMIT 1`,
    params,
  ));
  if (rows.length === 0 || !rows[0]!.blob_key) return jsonError(404, 'not_found');

  const store = filesStore();
  const blob = await store.get(rows[0]!.blob_key, { type: 'arrayBuffer' });
  if (!blob) return jsonError(404, 'blob_missing');

  const filename = rows[0]!.filename ?? 'file';
  return new Response(blob, {
    status: 200,
    headers: {
      'content-type': rows[0]!.mime ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'cache-control': 'private, max-age=0',
    },
  });
};
