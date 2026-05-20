/**
 * blobStorage — thin wrapper over Netlify Blobs.
 *
 * v1 file backend for product images (and later exports + backups). Replaces
 * the Google Drive integration, which doesn't work for consumer Gmail
 * accounts (service accounts have no storage quota; OAuth user delegation
 * works but is heavier than v1 needs).
 *
 * Layout:
 *   product-images store, keys of the form `<workspaceId>_<productId>_<random>`
 *
 * Underscore-joined instead of slash-joined so the key fits cleanly in a
 * single URL path segment (`/api/img/:pid/:key`) without routing surprises.
 *
 * Why include workspaceId in the key when image IDs already imply a product?
 *   - Cheap defense-in-depth if the proxy endpoint's binding check were ever
 *     bypassed: a brute-forcer would still need workspace + product + the
 *     random suffix.
 *   - Future per-workspace enumeration via key-prefix scanning when we
 *     migrate the key format to slashes.
 *
 * In Netlify production this hits Netlify's managed blob store. In `netlify
 * dev` it hits a local sandbox automatically — no setup needed for either.
 */

import { getStore, type Store } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

/** Netlify Blobs store name dedicated to product imagery. */
const IMAGE_STORE = 'product-images';

let _imageStore: Store | null = null;

function imageStore(): Store {
  if (_imageStore) return _imageStore;
  _imageStore = getStore({ name: IMAGE_STORE, consistency: 'strong' });
  return _imageStore;
}

/**
 * Stores image bytes and returns the opaque key the caller should record
 * on the product row (e.g. into `primary_image_id`).
 *
 * The key encodes workspace + product so we can later enumerate or sweep
 * per tenant without a database join. The random suffix prevents key
 * collisions across uploads.
 */
export async function putImage(
  workspaceId: string,
  productId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const id = randomUUID();
  const key = `${workspaceId}_${productId}_${id}`;
  // `set` accepts ArrayBuffer | string | ReadableStream | Blob | Buffer.
  // We have a Uint8Array — convert to its underlying ArrayBuffer for the
  // strict overload.
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await imageStore().set(key, buf, {
    metadata: { contentType, productId, workspaceId },
  });
  return key;
}

/**
 * Returns a ReadableStream of the bytes for a given image key, or null if
 * the key is not present. Used by `/api/img` to stream to the Netlify
 * Image CDN.
 */
export async function getImage(
  key: string,
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string } | null> {
  const r = await imageStore().getWithMetadata(key, { type: 'stream' });
  if (!r) return null;
  const ct =
    typeof (r.metadata as Record<string, unknown> | null)?.['contentType'] === 'string'
      ? ((r.metadata as Record<string, unknown>)['contentType'] as string)
      : 'application/octet-stream';
  return { stream: r.data as ReadableStream<Uint8Array>, contentType: ct };
}

/**
 * Deletes an image. Returns silently if the key doesn't exist. Used by
 * janitor passes and (eventually) the "remove image" UI.
 */
export async function deleteImage(key: string): Promise<void> {
  await imageStore().delete(key);
}

/**
 * Validates that an image key has the expected `<wsid>/<pid>/<uuid>` shape
 * before we let it into a URL path or DB column. Defense against junk
 * client input — we generate the key ourselves but never trust round-trips.
 */
const KEY_RE = /^[0-9a-f-]{36}_[0-9a-f-]{36}_[0-9a-f-]{36}$/i;
export function isWellFormedKey(key: string): boolean {
  return KEY_RE.test(key);
}
