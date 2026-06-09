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

  const thumbKey = productThumbKeyFor(blob_key);
  const thumbStore = productThumbnailsStore();

  // Cache hit
  const cached = await thumbStore.get(thumbKey, { type: 'arrayBuffer' });
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        'content-type': 'image/webp',
        'cache-control': `public, max-age=${THUMB_CACHE_SECONDS}, immutable`,
      },
    });
  }

  // Cache miss — read source
  const sourceBytes = await productImagesStore().get(blob_key, { type: 'arrayBuffer' });
  if (!sourceBytes) {
    return jsonError(404, 'source_missing');
  }

  // Resize via sharp. Lazy-import so the handler still type-checks if the lib
  // is missing — the actual call will throw and trip the fallback. Tasks 5+6
  // exercise both branches.
  try {
    const sharp = (await import('sharp')).default;
    const webp = await sharp(Buffer.from(sourceBytes))
      .resize(240, 240, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    // sharp returns a Node Buffer; copy to a plain ArrayBuffer slice so the
    // Blobs store and Response constructor accept it uniformly.
    const ab = webp.buffer.slice(webp.byteOffset, webp.byteOffset + webp.byteLength) as ArrayBuffer;
    try {
      await thumbStore.set(thumbKey, ab);
    } catch (e) {
      // Cache write failed — serve the freshly-resized bytes anyway.
      console.warn('u-products-image-thumb: cache write failed', { image_id: id, reason: String(e) });
    }
    return new Response(ab, {
      status: 200,
      headers: {
        'content-type': 'image/webp',
        'cache-control': `public, max-age=${THUMB_CACHE_SECONDS}, immutable`,
      },
    });
  } catch (e) {
    console.warn('u-products-image-thumb: resize failed, serving original', { image_id: id, reason: String(e) });
    // Best-effort original content-type. We don't track it on product_images —
    // the upload validates it but doesn't persist mime. Fall back to a sniff:
    // first byte 0xFF==jpeg, 0x89==png, 0x52==webp(RIFF), 0x47==gif. Default jpeg.
    const head = new Uint8Array(sourceBytes.slice(0, 4));
    let mime = 'image/jpeg';
    if (head[0] === 0x89 && head[1] === 0x50) mime = 'image/png';
    else if (head[0] === 0x47 && head[1] === 0x49) mime = 'image/gif';
    else if (head[0] === 0x52 && head[1] === 0x49) mime = 'image/webp';
    return new Response(sourceBytes, {
      status: 200,
      headers: {
        'content-type': mime,
        'cache-control': `public, max-age=${THUMB_FALLBACK_CACHE_SECONDS}`,
      },
    });
  }
};
