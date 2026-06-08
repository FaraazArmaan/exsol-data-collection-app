// /api/u-products-image          — POST: multipart upload that writes to Blobs
//                                  AND inserts a product_images row in one shot.
// /api/u-products-image/:id      — DELETE: removes the row + blob, rotates hero
//                                  if the deleted image was the hero.
//
// All operations require products.products.edit. The 6 MB Netlify Functions
// body limit caps the practical image size; the endpoint additionally enforces
// MAX_IMAGE_BYTES (10 MB) and MAX_IMAGES_PER_PRODUCT (20).

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { logAudit } from './_shared/audit';
import {
  productImagesStore, productImageKey,
  ALLOWED_MIME, MAX_IMAGE_BYTES, MAX_IMAGES_PER_PRODUCT,
} from './_shared/products-storage';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function imageIdFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/u-products-image\/([^/?]+)/);
  return m && UUID_RE.test(m[1]!) ? m[1]! : null;
}

export default async (req: Request, _ctx: Context) => {
  const auth = await authenticateForPermission(req, 'products.products.edit');
  if (auth instanceof Response) return auth;
  const session = auth;
  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  if (req.method === 'POST')   return handleUpload(req, session, clientId);
  if (req.method === 'DELETE') return handleDelete(req, session, clientId);
  return jsonError(405, 'method_not_allowed');
};

async function handleUpload(
  req: Request,
  session: Awaited<ReturnType<typeof authenticateForPermission>> extends Response ? never : Exclude<Awaited<ReturnType<typeof authenticateForPermission>>, Response>,
  clientId: string,
): Promise<Response> {
  // Expect multipart/form-data with fields: product_id, file
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) return jsonError(400, 'multipart_required');

  let form: FormData;
  try { form = await req.formData(); } catch { return jsonError(400, 'invalid_multipart'); }

  const productId = form.get('product_id');
  const file = form.get('file');
  if (typeof productId !== 'string' || !UUID_RE.test(productId)) return jsonError(400, 'invalid_product_id');
  if (!(file instanceof Blob)) return jsonError(400, 'file_required');
  if (!ALLOWED_MIME.has(file.type)) return jsonError(400, 'unsupported_mime');
  if (file.size === 0) return jsonError(400, 'empty_file');
  if (file.size > MAX_IMAGE_BYTES) return jsonError(413, 'file_too_large');

  const sql = db();

  // Confirm product belongs to caller's client + count existing images.
  const prodRows = (await sql`
    SELECT p.id, p.hero_image_key,
           (SELECT COUNT(*) FROM public.product_images pi WHERE pi.product_id = p.id)::int AS image_count
    FROM public.products p
    WHERE p.id = ${productId}::uuid AND p.client_id = ${clientId}::uuid AND p.deleted_at IS NULL
    LIMIT 1
  `) as Array<{ id: string; hero_image_key: string | null; image_count: number }>;
  if (prodRows.length === 0) return jsonError(404, 'product_not_found');
  const prod = prodRows[0]!;
  if (prod.image_count >= MAX_IMAGES_PER_PRODUCT) return jsonError(422, 'max_images_reached');

  const blob_key = productImageKey(clientId, productId);
  const bytes = await file.arrayBuffer();
  await productImagesStore().set(blob_key, bytes);

  const sortOrder = prod.image_count; // append to end
  let imageRow: { id: string; blob_key: string; sort_order: number };
  try {
    const inserted = (await sql`
      INSERT INTO public.product_images (product_id, blob_key, sort_order)
      VALUES (${productId}::uuid, ${blob_key}, ${sortOrder})
      RETURNING id, blob_key, sort_order
    `) as Array<{ id: string; blob_key: string; sort_order: number }>;
    imageRow = inserted[0]!;
  } catch (e) {
    // Blob written but row insert failed — orphan it for the GC pass.
    await productImagesStore().delete(blob_key).catch(() => { /* */ });
    throw e;
  }

  // First image becomes hero automatically.
  if (!prod.hero_image_key) {
    await sql`UPDATE public.products SET hero_image_key = ${blob_key}, updated_at = now() WHERE id = ${productId}::uuid`;
  }

  await logAudit(sql, {
    session, op: 'products.image_added',
    clientId, targetType: 'product', targetId: productId,
    detail: { image_id: imageRow.id, blob_key },
  });

  return jsonOk(imageRow, { status: 201 });
}

async function handleDelete(
  req: Request,
  session: Exclude<Awaited<ReturnType<typeof authenticateForPermission>>, Response>,
  clientId: string,
): Promise<Response> {
  const imgId = imageIdFromUrl(req);
  if (!imgId) return jsonError(400, 'invalid_id');

  const sql = db();
  const rows = (await sql`
    SELECT pi.id, pi.blob_key, pi.product_id, p.hero_image_key
    FROM public.product_images pi
    JOIN public.products p ON p.id = pi.product_id
    WHERE pi.id = ${imgId}::uuid AND p.client_id = ${clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; blob_key: string; product_id: string; hero_image_key: string | null }>;
  if (rows.length === 0) return jsonError(404, 'not_found');
  const row = rows[0]!;

  await sql`DELETE FROM public.product_images WHERE id = ${imgId}::uuid`;
  await productImagesStore().delete(row.blob_key).catch(() => { /* orphan tolerated */ });

  // If this was the hero, pick the next image (lowest sort_order) as the new hero.
  if (row.hero_image_key === row.blob_key) {
    const next = (await sql`
      SELECT blob_key FROM public.product_images
      WHERE product_id = ${row.product_id}::uuid
      ORDER BY sort_order ASC LIMIT 1
    `) as Array<{ blob_key: string }>;
    await sql`
      UPDATE public.products SET hero_image_key = ${next[0]?.blob_key ?? null}, updated_at = now()
      WHERE id = ${row.product_id}::uuid
    `;
  }

  await logAudit(sql, {
    session, op: 'products.image_deleted',
    clientId, targetType: 'product', targetId: row.product_id,
    detail: { image_id: imgId, blob_key: row.blob_key },
  });
  return new Response(null, { status: 204 });
}
