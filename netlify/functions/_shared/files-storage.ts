// Netlify Blobs helpers for the File Manager.
//
// Key structure:
//   admin/<uuid>                                 — admin vault file
//   workspace/<clientId>/<uuid>                  — workspace file
//   thumb/<original-key>.webp                    — thumbnail
//
// Each shape is enforced by isAllowedBlobKeyShape — endpoints validate any
// blob_key arriving from the browser before passing it to Blobs.

import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

export const FILES_STORE = 'files';
export const FILES_THUMBNAILS_STORE = 'files-thumbnails';

export type BlobScope =
  | { scope: 'admin'; uuid?: string }
  | { scope: 'workspace'; clientId: string; uuid?: string };

export function blobKeyFor(scope: BlobScope): string {
  const uuid = scope.uuid ?? randomUUID();
  if (scope.scope === 'admin') return `admin/${uuid}`;
  return `workspace/${scope.clientId}/${uuid}`;
}

export function thumbnailKeyFor(blobKey: string): string {
  return `thumb/${blobKey}.webp`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAllowedBlobKeyShape(key: string): boolean {
  if (!key || key.includes('..')) return false;
  const parts = key.split('/');
  if (parts[0] === 'admin') {
    return parts.length === 2 && UUID_RE.test(parts[1]!);
  }
  if (parts[0] === 'workspace') {
    return parts.length === 3 && UUID_RE.test(parts[1]!) && UUID_RE.test(parts[2]!);
  }
  return false;
}

export function filesStore() {
  return getStore({ name: FILES_STORE, consistency: 'strong' });
}

export function thumbnailsStore() {
  return getStore({ name: FILES_THUMBNAILS_STORE, consistency: 'eventual' });
}
