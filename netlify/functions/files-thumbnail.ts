// GET /api/files-thumbnail/:id
// Phase A: returns stored thumbnail bytes when present, else 404.
// Lazy generation is wired in Phase B.

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { authenticateForPermission } from './_shared/permissions';
import sharp from 'sharp';
import { TIER_VISIBILITY_CLAUSE, visibilityValues, resolveRoleId } from './_shared/files-access';
import { filesStore, thumbnailsStore, thumbnailKeyFor } from './_shared/files-storage';

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
  const rows = (await (sql as unknown as (q: string, p: unknown[]) => Promise<Array<{ thumbnail_key: string | null; type: string; blob_key: string | null }>>)(
    `SELECT thumbnail_key, type, blob_key FROM public.files WHERE ${clauses.join(' AND ')} LIMIT 1`,
    params,
  ));
  if (rows.length === 0) return jsonError(404, 'not_found');
  const file = rows[0]!;
  if (file.type !== 'image') return jsonError(415, 'thumbnail_unsupported_for_type');

  const webpHeaders = { 'content-type': 'image/webp', 'cache-control': 'public, max-age=86400' };

  // Lazy-generate on first request.
  if (!file.thumbnail_key) {
    if (!file.blob_key) return jsonError(404, 'thumbnail_unavailable');
    const original = await filesStore().get(file.blob_key, { type: 'arrayBuffer' });
    if (!original) return jsonError(404, 'blob_missing');
    let webp: Buffer;
    try {
      webp = await sharp(Buffer.from(original)).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    } catch (e) {
      console.error('[files] thumbnail generation failed', e);
      return jsonError(422, 'thumbnail_generation_failed');
    }
    // sharp returns a Node Buffer; copy to a plain ArrayBuffer slice so the
    // Blobs store and Response constructor accept it uniformly.
    const ab = webp.buffer.slice(webp.byteOffset, webp.byteOffset + webp.byteLength) as ArrayBuffer;
    const thumbKey = thumbnailKeyFor(file.blob_key);
    await thumbnailsStore().set(thumbKey, ab);
    await sql`UPDATE public.files SET thumbnail_key = ${thumbKey} WHERE id = ${id}::uuid`;
    return new Response(ab, { status: 200, headers: webpHeaders });
  }

  const bytes = await thumbnailsStore().get(file.thumbnail_key, { type: 'arrayBuffer' });
  if (!bytes) return jsonError(404, 'thumbnail_missing');
  return new Response(bytes, { status: 200, headers: webpHeaders });
};
