// Netlify Blobs helpers for product image thumbnails. A dedicated store
// ('product-image-thumbnails') parallel to the source 'product-images' store
// keeps thumbnail lifecycle isolated from full-size images.
//
// Key shape: thumb/<original_blob_key>.webp
//
// Content-addressed by the immutable source blob_key — a "replace image"
// always mints a fresh source key, so cached thumbs never need invalidation.

import { getStore } from '@netlify/blobs';

export const PRODUCT_IMAGE_THUMBNAILS_STORE = 'product-image-thumbnails';
export const THUMB_MAX_EDGE = 240;
export const THUMB_QUALITY = 80;
export const THUMB_CACHE_SECONDS = 30 * 24 * 60 * 60;   // 30 days, immutable
export const THUMB_FALLBACK_CACHE_SECONDS = 5 * 60;     // 5 minutes, fallback

export function productThumbnailsStore() {
  return getStore({ name: PRODUCT_IMAGE_THUMBNAILS_STORE, consistency: 'eventual' });
}

export function productThumbKeyFor(sourceBlobKey: string): string {
  return `thumb/${sourceBlobKey}.webp`;
}
