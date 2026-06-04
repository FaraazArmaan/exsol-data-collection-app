// GET /api/files-thumbnail/:id
// Phase A: returns stored thumbnail bytes when present, else 404.
// Lazy generation is wired in Phase B.

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { authenticateForPermission } from './_shared/permissions';
import { TIER_VISIBILITY_CLAUSE, visibilityValues, resolveRoleId } from './_shared/files-access';
import { thumbnailsStore } from './_shared/files-storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/files-thumbnail\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');

  const auth = await authenticateForPermission(req, '_platform.files.view');
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
  const rows = (await (sql as unknown as (q: string, p: unknown[]) => Promise<Array<{ thumbnail_key: string | null; type: string }>>)(
    `SELECT thumbnail_key, type FROM public.files WHERE ${clauses.join(' AND ')} LIMIT 1`,
    params,
  ));
  if (rows.length === 0) return jsonError(404, 'not_found');
  if (rows[0]!.type !== 'image') return jsonError(415, 'thumbnail_unsupported_for_type');
  if (!rows[0]!.thumbnail_key) return jsonError(404, 'thumbnail_not_generated');

  const bytes = await thumbnailsStore().get(rows[0]!.thumbnail_key, { type: 'arrayBuffer' });
  if (!bytes) return jsonError(404, 'thumbnail_missing');

  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=86400' },
  });
};
