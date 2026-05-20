/**
 * imagePipeline (Module 10)
 *
 * Coordinates product-image uploads and serving via Netlify Blobs:
 *
 *   Browser ── POST multipart ─► Netlify Function ── putImage ──► Blobs
 *                                       ── registerUploadedFile ──► products row
 *   Browser ◄── GET /.netlify/images?url=/api/img/<pid>/<key>&w=... ── Image CDN ── /api/img ── getImage ── Blobs
 *
 * Why through a function on upload? Browser-direct uploads to Netlify
 * Blobs require signed URLs, and v1 has a hard 5 MB cap from Function
 * body limits anyway — product photos comfortably fit, so the
 * simpler-architecture wins until we need >5 MB uploads.
 *
 * Why through a function on read? Netlify Image CDN edge-caches the
 * downstream response, so the function only runs on cache miss.
 * Aggressive `immutable` cache headers + content-addressed keys ensure
 * a key never serves stale bytes.
 *
 * Surface (kept stable across the Drive → Blobs pivot — only the
 * uploadAndRegister entrypoint is wired from HTTP today; the
 * init/complete pair is dead code retained for the future direct-upload
 * pattern):
 *   - uploadAndRegister(actor, productId, filename, mime, body, slot)
 *       Validates, stores in Blobs, attaches the key to the product row,
 *       audit-logs. Returns the updated image columns.
 *   - registerUploadedFile(actor, productId, imageKey, slot)
 *       Lower-level: attach a previously-stored key to a product row.
 *   - proxyUrl(productId, imageKey, variant)
 *       Pure helper returning the Netlify Image CDN URL for a variant.
 *   - streamImage(productId, imageKey)
 *       Looks up the binding, returns a ReadableStream for /api/img.
 *
 * Permission gating is the calling HTTP endpoint's job (file:upload).
 * This module trusts the supplied ActorContext.
 */

import { withTenantContext } from './tenancy.ts';
import { pool } from './db.ts';
import * as blobStorage from './blob-storage.ts';
import { record as recordAudit } from './audit-log-writer.ts';
import type { ActorContext } from './types.ts';

// ---------- Public types ----------

/** Where on the product row a registered file should be attached. */
export type ImageSlot = 'primary' | 'extra';

/** Rendering size hint used to map to Image CDN query parameters. */
export type ImageVariant = 'thumb' | 'card' | 'full';

export type RegisterResult = {
  /** Updated primary image key (may be null if slot='extra' and no primary set). */
  primaryImageId: string | null;
  /** Updated extras array. */
  extraImageIds: string[];
};

export type InitError =
  | { error: 'product_not_found' }
  | { error: 'invalid_mime'; detail: string }
  | { error: 'invalid_size'; detail: string }
  | { error: 'invalid_filename'; detail: string };

export type RegisterError =
  | { error: 'product_not_found' }
  | { error: 'invalid_slot' }
  | { error: 'invalid_image_key' };

// ---------- Constants ----------

/**
 * Browser-uploadable formats. SVG is intentionally excluded — it can carry
 * embedded JavaScript and would defeat the unauthenticated image proxy.
 */
const ALLOWED_MIME: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

/**
 * Per-image upload cap. v1 routes bytes through a Netlify Function (6 MB
 * body limit on the platform), so we cap at 5 MB to leave headroom for the
 * multipart envelope + any client-supplied form fields. The browser is
 * asked to enforce this client-side; we enforce it again here so a hostile
 * client can't burn storage with a giant file.
 *
 * Future: when we move to browser-direct uploads via signed URLs, this
 * can climb to whatever Blobs natively supports.
 */
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Mapping from variant to Netlify Image CDN query string.
//   w   = target width in CSS pixels (CDN handles 2x/3x DPR automatically when fm=webp/avif is negotiated)
//   fit = cover  (crop to box, focal at center) for thumb/card; absent for full (preserve aspect)
//   q   = JPEG/WebP quality. Lower for thumbs since they're small.
const VARIANT_QUERY: Record<ImageVariant, string> = {
  thumb: 'w=200&h=200&fit=cover&q=75',
  card: 'w=600&h=600&fit=cover&q=80',
  full: 'w=1600&q=85',
};

// ---------- Operations ----------

/**
 * Attaches a Blobs key to a product.
 *
 * `slot='primary'` overwrites `primary_image_id`. The previous primary
 * (if any) is NOT auto-deleted from Blobs — deliberate so the user can
 * recover from a mistaken replacement. A future janitor pass can sweep
 * orphans (Blobs keys not referenced by any product row).
 *
 * `slot='extra'` appends to `extra_image_ids` using `array_append`
 * (atomic, dedup-safe). Re-registering the same key is a no-op.
 *
 * Returns the post-update image columns so the caller can render the
 * new thumbnail without a follow-up GET.
 */
export async function registerUploadedFile(
  actor: ActorContext,
  productId: string,
  imageKey: string,
  slot: ImageSlot,
): Promise<RegisterResult | RegisterError> {
  if (!actor.workspaceId) throw new Error('workspaceId required');
  if (slot !== 'primary' && slot !== 'extra') return { error: 'invalid_slot' };
  if (!blobStorage.isWellFormedKey(imageKey)) return { error: 'invalid_image_key' };

  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      // Pre-check the product exists in this workspace so we can return a
      // clean 404 instead of a silent UPDATE 0 rows.
      const beforeRes = await c.query(
        `SELECT primary_image_id, extra_image_ids
         FROM products WHERE id = $1`,
        [productId],
      );
      if ((beforeRes.rowCount ?? 0) === 0) return { error: 'product_not_found' };
      const before = beforeRes.rows[0];

      let row;
      if (slot === 'primary') {
        const r = await c.query(
          `UPDATE products
             SET primary_image_id = $2,
                 updated_at = now(),
                 updated_by = $3
           WHERE id = $1
           RETURNING primary_image_id, extra_image_ids`,
          [productId, imageKey, actor.onBehalfOfId ?? actor.realActorId],
        );
        row = r.rows[0];
      } else {
        // Dedup: only append if not already present in primary OR extras.
        const r = await c.query(
          `UPDATE products
             SET extra_image_ids = CASE
                   WHEN $2 = ANY(extra_image_ids) THEN extra_image_ids
                   WHEN $2 = primary_image_id THEN extra_image_ids
                   ELSE array_append(extra_image_ids, $2)
                 END,
                 updated_at = now(),
                 updated_by = $3
           WHERE id = $1
           RETURNING primary_image_id, extra_image_ids`,
          [productId, imageKey, actor.onBehalfOfId ?? actor.realActorId],
        );
        row = r.rows[0];
      }

      await recordAudit(
        {
          realActorId: actor.realActorId,
          onBehalfOfId: actor.onBehalfOfId ?? null,
          impersonationReason: actor.impersonationReason,
          workspaceId: actor.workspaceId,
          action: 'product.image_register',
          resourceType: 'product',
          resourceId: productId,
          before: {
            primaryImageId: before.primary_image_id ?? null,
            extraImageIds: before.extra_image_ids ?? [],
          },
          after: {
            slot,
            imageKey,
            primaryImageId: row.primary_image_id ?? null,
            extraImageIds: row.extra_image_ids ?? [],
          },
        },
        c,
      );

      return {
        primaryImageId: row.primary_image_id ?? null,
        extraImageIds: row.extra_image_ids ?? [],
      };
    },
  );
}

/**
 * One-shot upload: take raw bytes coming from a multipart POST, push them
 * to Netlify Blobs, and attach the resulting key to the product in one call.
 *
 * Used by `/api/.../images/upload`. Validates MIME + size, stores in Blobs
 * under `<workspaceId>/<productId>/<uuid>`, then attaches the key to the
 * product row.
 */
export async function uploadAndRegister(
  actor: ActorContext,
  productId: string,
  filename: string,
  mime: string,
  body: Buffer | Uint8Array,
  slot: ImageSlot,
): Promise<RegisterResult | InitError | RegisterError> {
  if (!actor.workspaceId) throw new Error('workspaceId required');

  const cleanFilename = sanitizeFilename(filename);
  if (!cleanFilename) {
    return { error: 'invalid_filename', detail: 'Filename is empty or unsafe.' };
  }
  if (!ALLOWED_MIME.has(mime)) {
    return { error: 'invalid_mime', detail: `Allowed: ${[...ALLOWED_MIME].join(', ')}. Got: ${mime}.` };
  }
  const size = body.byteLength;
  if (size <= 0) return { error: 'invalid_size', detail: 'Empty file.' };
  if (size > MAX_BYTES) {
    return { error: 'invalid_size', detail: `File exceeds ${Math.floor(MAX_BYTES / (1024 * 1024))} MB limit.` };
  }
  if (slot !== 'primary' && slot !== 'extra') return { error: 'invalid_slot' };

  // Confirm the product exists in this workspace before storing the file
  // (otherwise an attacker with a valid auth could pump bytes into Blobs
  // against a productId they don't own).
  const exists = await withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      const r = await c.query(`SELECT 1 FROM products WHERE id = $1`, [productId]);
      return (r.rowCount ?? 0) > 0;
    },
  );
  if (!exists) return { error: 'product_not_found' };

  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const imageKey = await blobStorage.putImage(actor.workspaceId, productId, bytes, mime);
  return registerUploadedFile(actor, productId, imageKey, slot);
}

/**
 * Returns the Netlify Image CDN URL for a given (productId, imageKey)
 * pair at the requested rendering variant. The CDN fetches the upstream
 * `/api/img/<pid>/<key>` endpoint on cache miss, transforms the bytes
 * (resize/recompress to webp/avif as the browser advertises), and caches
 * the result at the edge.
 *
 * Pure helper — no storage or DB calls. Safe to call from a request handler
 * for every product in a list.
 */
export function proxyUrl(
  productId: string,
  imageKey: string,
  variant: ImageVariant,
): string {
  const upstream = `/api/img/${encodeURIComponent(productId)}/${encodeURIComponent(imageKey)}`;
  const qs = VARIANT_QUERY[variant];
  return `/.netlify/images?url=${encodeURIComponent(upstream)}&${qs}`;
}

/**
 * Streams the raw bytes of a stored image. Used by the `/api/img` proxy
 * endpoint. The product-id binding is verified with an admin-elevated
 * read so the proxy can serve unauthenticated requests (necessary
 * because the Netlify Image CDN can't forward user cookies).
 *
 * Returns null if the (productId, imageKey) pair isn't bound on any
 * product; the caller should 404 in that case.
 */
export async function streamImage(
  productId: string,
  imageKey: string,
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string } | null> {
  if (!blobStorage.isWellFormedKey(imageKey)) return null;
  const ok = await verifyImageBinding(productId, imageKey);
  if (!ok) return null;
  return blobStorage.getImage(imageKey);
}

// ---------- Internals ----------

/**
 * Confirms `imageKey` is currently attached (primary or extra) to
 * `productId`. Runs without an RLS tenant context, since the image proxy
 * is unauthenticated by design. Read-only and narrow — the only thing it
 * can answer is "yes/no, is this pair bound."
 */
async function verifyImageBinding(productId: string, imageKey: string): Promise<boolean> {
  const client = await pool().connect();
  try {
    // RLS on products requires either is_admin='true' or workspace membership.
    // For the public image proxy we elevate temporarily with is_admin='true'
    // and a sentinel user id. The query is read-only and tightly scoped to a
    // single product/image binding, so this is the smallest possible elevation.
    await client.query(
      `SELECT set_config('app.current_user_id', $1, true),
              set_config('app.current_workspace_id', '', true),
              set_config('app.is_admin', 'true', true)`,
      ['00000000-0000-0000-0000-000000000000'],
    );
    const r = await client.query(
      `SELECT 1 FROM products
       WHERE id = $1
         AND (primary_image_id = $2 OR $2 = ANY(extra_image_ids))
       LIMIT 1`,
      [productId, imageKey],
    );
    return (r.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

/**
 * Strips path separators and control characters from a user-supplied
 * filename. Drive accepts most characters, but we want to keep paths sane
 * in logs and forbid traversal-style names. Returns null if the result is
 * empty.
 */
function sanitizeFilename(name: string): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = name
    .normalize('NFKC')
    .replace(/[ -]/g, '') // strip control chars
    .replace(/[\\/]/g, '_')                 // path separators -> _
    .replace(/^\.+/, '')                    // no leading dots (no .hidden, no ..)
    .trim();
  if (cleaned.length === 0 || cleaned.length > 200) return null;
  return cleaned;
}
