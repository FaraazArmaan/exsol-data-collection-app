// GET /api/u-products-image-thumb/:image_id
//
// Lazy 240px webp thumbnails for product images. Cache hit ➜ serve.
// Cache miss ➜ read source, resize via sharp, write cache, serve.
// Resize failure ➜ stream original bytes (UI never shows broken tile).
//
// Tenant gate: SQL JOIN enforces products.client_id = caller's client.
// L1 owner and admin bypasses are inherited from authenticateForPermission.

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { productImagesStore } from './_shared/products-storage';
import {
  productThumbnailsStore,
  productThumbKeyFor,
  THUMB_CACHE_SECONDS,
  THUMB_FALLBACK_CACHE_SECONDS,
} from './_shared/products-thumbnails';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function imageIdFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/u-products-image-thumb\/([^/?]+)/);
  return m && UUID_RE.test(m[1]!) ? m[1]! : null;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const auth = await authenticateForPermission(req, 'products.products.view');
  if (auth instanceof Response) return auth;
  const session = auth;

  const id = imageIdFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');

  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const sql = db();
  const rows = (await sql`
    SELECT pi.blob_key
    FROM public.product_images pi
    JOIN public.products p ON p.id = pi.product_id
    WHERE pi.id = ${id}::uuid AND p.client_id = ${clientId}::uuid AND p.deleted_at IS NULL
    LIMIT 1
  `) as Array<{ blob_key: string }>;
  if (rows.length === 0) return jsonError(404, 'image_not_found');
  const { blob_key } = rows[0]!;

  // Stub for Task 4. Forces the failing test for cache-hit to drive the next step.
  return jsonError(501, 'not_implemented');
  void productImagesStore; void productThumbnailsStore; void productThumbKeyFor;
  void THUMB_CACHE_SECONDS; void THUMB_FALLBACK_CACHE_SECONDS; void blob_key;
};
