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

// ---------- Export files ----------

/** Netlify Blobs store dedicated to generated catalog exports (Module 11). */
const EXPORT_STORE = 'product-exports';

let _exportStore: Store | null = null;

function exportStore(): Store {
  if (_exportStore) return _exportStore;
  _exportStore = getStore({ name: EXPORT_STORE, consistency: 'strong' });
  return _exportStore;
}

/**
 * Stores generated export bytes (XLSX/CSV) and returns the opaque key.
 * Used by `exportEngine` to persist sync-mode output and any async-mode
 * results once the worker pipeline lands.
 */
export async function putExport(
  workspaceId: string,
  jobId: string,
  filename: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const key = `${workspaceId}_${jobId}`;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await exportStore().set(key, buf, {
    metadata: { contentType, filename, workspaceId, jobId },
  });
  return key;
}

/**
 * Returns the bytes + filename + content-type for a previously stored
 * export, or null if absent. Used by the download endpoint to stream a
 * completed export back to the user as a file attachment.
 */
export async function getExport(
  key: string,
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; filename: string } | null> {
  const r = await exportStore().getWithMetadata(key, { type: 'stream' });
  if (!r) return null;
  const meta = (r.metadata as Record<string, unknown> | null) ?? {};
  const ct = typeof meta['contentType'] === 'string' ? (meta['contentType'] as string) : 'application/octet-stream';
  const filename = typeof meta['filename'] === 'string' ? (meta['filename'] as string) : 'export';
  return { stream: r.data as ReadableStream<Uint8Array>, contentType: ct, filename };
}

// ---------- Backup files ----------

/**
 * Per-workspace backups (Primary-triggered ZIPs containing product data,
 * stock ledger, audit events, and image bytes). Separated from exports so
 * retention policies and access controls can differ — backups are
 * disaster-recovery artifacts and tend to be much larger than exports.
 */
const WORKSPACE_BACKUP_STORE = 'workspace-backups';
let _workspaceBackupStore: Store | null = null;
function workspaceBackupStore(): Store {
  if (_workspaceBackupStore) return _workspaceBackupStore;
  _workspaceBackupStore = getStore({ name: WORKSPACE_BACKUP_STORE, consistency: 'strong' });
  return _workspaceBackupStore;
}

/**
 * Admin-only system backups (cross-workspace DB dumps). Separate store
 * so that destructive operations (clear a workspace's backups, etc.)
 * can never accidentally hit the system backup set.
 */
const SYSTEM_BACKUP_STORE = 'system-backups';
let _systemBackupStore: Store | null = null;
function systemBackupStore(): Store {
  if (_systemBackupStore) return _systemBackupStore;
  _systemBackupStore = getStore({ name: SYSTEM_BACKUP_STORE, consistency: 'strong' });
  return _systemBackupStore;
}

/**
 * Reads bytes of a previously-stored Blob from the chosen image, export,
 * or backup store. Used by streamImage. Image-specific (image-pipeline
 * calls `getImage` directly); kept here so the streaming pattern is the
 * same across stores.
 */
async function readBlob(
  store: Store,
  key: string,
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string; filename: string } | null> {
  const r = await store.getWithMetadata(key, { type: 'stream' });
  if (!r) return null;
  const meta = (r.metadata as Record<string, unknown> | null) ?? {};
  const ct = typeof meta['contentType'] === 'string' ? (meta['contentType'] as string) : 'application/octet-stream';
  const filename = typeof meta['filename'] === 'string' ? (meta['filename'] as string) : 'backup';
  return { stream: r.data as ReadableStream<Uint8Array>, contentType: ct, filename };
}

export async function putWorkspaceBackup(
  workspaceId: string,
  backupId: string,
  filename: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const key = `${workspaceId}_${backupId}`;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await workspaceBackupStore().set(key, buf, {
    metadata: { contentType, filename, workspaceId, backupId },
  });
  return key;
}

export async function getWorkspaceBackup(key: string) {
  return readBlob(workspaceBackupStore(), key);
}

export async function putSystemBackup(
  backupId: string,
  filename: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const key = `system_${backupId}`;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await systemBackupStore().set(key, buf, {
    metadata: { contentType, filename, backupId },
  });
  return key;
}

export async function getSystemBackup(key: string) {
  return readBlob(systemBackupStore(), key);
}

/**
 * Deletes a backup. Used by retention pruning (planned v1.1) and any
 * future "delete this backup" UI.
 */
export async function deleteWorkspaceBackup(key: string): Promise<void> {
  await workspaceBackupStore().delete(key);
}

export async function deleteSystemBackup(key: string): Promise<void> {
  await systemBackupStore().delete(key);
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
