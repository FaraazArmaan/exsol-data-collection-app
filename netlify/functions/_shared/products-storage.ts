// Netlify Blobs helpers for product images. A dedicated store ('product-images')
// parallel to the file-manager store keeps catalog images isolated from
// business-document files.
//
// Key shape: product-images/<clientId>/<productId>/<uuid>
//
// 6 MB request-body limit on Netlify Functions caps the practical max image
// size; service-side validation rejects anything larger before writing to blobs.

import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

export const PRODUCT_IMAGES_STORE = 'product-images';
export const ALLOWED_MIME = new Set<string>(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;       // 10 MB hard cap
export const MAX_IMAGES_PER_PRODUCT = 20;

export function productImagesStore() {
  return getStore({ name: PRODUCT_IMAGES_STORE, consistency: 'strong' });
}

export function productImageKey(clientId: string, productId: string): string {
  return `product-images/${clientId}/${productId}/${randomUUID()}`;
}

const KEY_RE = /^product-images\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i;

export function isAllowedProductImageKey(key: string): boolean {
  return KEY_RE.test(key);
}
