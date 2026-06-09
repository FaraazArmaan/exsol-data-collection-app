# Product Image Thumbnails Endpoint — Design

**Date:** 2026-06-09
**Module:** Product Manager (Phase B)
**Status:** Approved
**Predecessor specs:** `docs/superpowers/specs/2026-06-08-product-manager-design.md`

---

## Problem

Product Manager Phase A shipped full-size image upload (`POST /api/u-products-image`, single-step multipart, stored in Netlify Blobs at `product-images/<clientId>/<productId>/<uuid>`). The product list table (`ProductTable.tsx`) and the per-product image gallery (`ProductImageGallery.tsx`) currently render `<div class="pm-thumb pm-thumb-placeholder" />` because there is no thumbnail endpoint. We need to surface real product image thumbnails with low first-byte latency, bounded storage cost, and no new deploy risk.

## Non-goals

- Multiple thumbnail sizes — single 240 px is sufficient for both consumers today (list ~60 px, gallery ~120–200 px).
- Image cropping, focal points, smart subject detection.
- Thumbnail backfill scripts for existing images — lazy generation handles existing rows on first view.
- A separate thumbnail for the product detail hero image — same endpoint, same size, retina-friendly via `<img srcset>` only if a later need arises.
- Migrating `files-thumbnail.ts` to share code. Different blob stores, different auth surface; abstracting prematurely risks coupling.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Generation strategy | Lazy server-side, cache to blob | Avoids regenerating on every request; first-request cost amortized. With sharp the cold-path resize is ~10–40 ms — well under our 500 ms budget. |
| Number of sizes | Single 240 px max edge, quality 80 | Covers both consumers; halves cache miss rate vs multi-size. |
| Image library | `sharp` (libvips, native) | Best WebP quality and 10–20× faster than pure-JS alternatives. Pivoted from `jimp@0.22` after Task 1 smoke discovered it ships no WebP encoder; `jimp@1.x` WASM path is API-unstable. Sharp's native binary requires `external_node_modules = ["sharp"]` in `netlify.toml` — same pattern already in use for `@node-rs/argon2`. |
| Failure behavior | Stream original bytes on resize failure | No broken-image tiles in the UI. Short Cache-Control on fallbacks retries soon. |
| Storage | New `product-image-thumbnails` blob store, eventual consistency | Mirrors `files-thumbnails` pattern. Keeps thumbnails isolated from full-size for lifecycle clarity. |
| Schema | None — derived key | Cache key is `thumb/<original_blob_key>.webp`. Source `blob_key` is immutable, so derivation is collision-free and migration-free. |
| URL shape | `GET /api/u-products-image-thumb/:image_id` | Flat path avoids the routing memory's literal-sub-path-under-:param-routes collision warning. Mirrors `files-thumbnail`. |
| Auth | `products.products.view` + tenant join | Read-only, mirrors product list. |
| Cache headers | `public, max-age=2592000, immutable` on success; `public, max-age=300` on fallback | Content-addressed by immutable blob_key, so `immutable` is honest. Short fallback TTL lets transient failures retry quickly. |

## Architecture

```
GET /api/u-products-image-thumb/:image_id
        │
        ▼
  authenticateForPermission('products.products.view')
        │
        ▼
  SQL: pi.blob_key, pi.product_id, p.client_id    ── tenant-isolated JOIN
        │
        ▼
  thumb_key = `thumb/${blob_key}.webp`
        │
        ▼
  ┌──── productThumbnailsStore.get(thumb_key) ─── hit ─► 200 webp, max-age=30d immutable
  │
  miss
  │
  ▼
  productImagesStore.get(blob_key)
        │
        ├── null ─► thumb exists? serve it. Else 404 source_missing.
        │
        ▼ bytes
  jimp.read → .scaleToFit(240, 240, RESIZE_BEZIER) → .quality(80) → .getBufferAsync(image/webp)
        │
        ├── throws ─► 200 original bytes, max-age=5min
        │
        ▼
  productThumbnailsStore.set(thumb_key, thumbBytes)   [awaited; .set errors swallowed]
        │
        ▼
  200 webp, max-age=30d immutable
```

## Files

### New

| Path | Purpose | LOC |
|---|---|---|
| `netlify/functions/u-products-image-thumb.ts` | Endpoint handler | ~80 |
| `netlify/functions/_shared/products-thumbnails.ts` | `productThumbnailsStore()`, `productThumbKeyFor(blobKey)`, `THUMB_MAX_EDGE = 240`, `THUMB_QUALITY = 80` | ~25 |
| `tests/unit/products-image-thumb.test.ts` | Pure-fn + 400/401/405 unit tests | ~120 |
| `tests/integration/products-image-thumb.test.ts` | DB+blob integration tests | ~250 |

### Modified

| Path | Change |
|---|---|
| `netlify/functions/u-products-image.ts` | DELETE handler also deletes `productThumbKeyFor(row.blob_key)` from `productThumbnailsStore()`, best-effort. |
| `netlify/functions/u-products.ts` | List query adds `LEFT JOIN public.product_images pi_hero ON pi_hero.product_id = p.id AND pi_hero.blob_key = p.hero_image_key` and selects `pi_hero.id AS hero_image_id`. Join is unique because `blob_key` is a freshly-minted UUID per upload (`productImageKey()`). Needed so the FE can construct the thumbnail URL. |
| `package.json` | Add `sharp` (latest stable, `^0.33.x`). |
| `netlify.toml` | Add `"sharp"` to the existing `external_node_modules = [...]` array (alongside `@node-rs/argon2`) so the platform-specific libvips binary ships with the function bundle. |
| `src/modules/products/shared/types.ts` | Add `hero_image_id: string \| null` to `ProductListRow`. |
| `src/modules/products/shared/api.ts` | Add `imagesApi.thumbUrl(imageId: string): string` returning `/api/u-products-image-thumb/${imageId}`. |
| `src/modules/products/workspace/components/ProductTable.tsx` | Replace `.pm-thumb-placeholder` with `<img src={thumbUrl(p.hero_image_id)} loading="lazy" alt="" className="pm-thumb" />` when present. Keep placeholder div when `hero_image_id` is null. |
| `src/modules/products/workspace/components/ProductImageGallery.tsx` | Same swap, using `thumbUrl(img.id)` for each gallery item. |
| `src/lib/components.css` | Ensure `.pm-thumb { object-fit: cover; width: 100%; height: 100%; }` so non-square sources render cleanly. |

## Endpoint contract

| Aspect | Value |
|---|---|
| Path | `GET /api/u-products-image-thumb/:image_id` |
| Auth | `products.products.view` |
| Tenant scope | image's product must satisfy `client_id = caller.client_id` |
| 200 (cached or freshly generated) | `Content-Type: image/webp`, `Cache-Control: public, max-age=2592000, immutable` |
| 200 (fallback after resize failure) | `Content-Type` of original (jpeg/png/webp/gif), `Cache-Control: public, max-age=300` |
| 400 | `invalid_id` — path segment is not a UUID |
| 401 | not authenticated (delegated to `authenticateForPermission`) |
| 403 | lacks `products.products.view` |
| 404 | `image_not_found` (row missing or cross-tenant) or `source_missing` (row exists, blob gone, no cached thumb) |
| 405 | non-GET |

## Failure handling

| Failure | Detection | Response |
|---|---|---|
| Image row missing / cross-tenant | SQL returns 0 rows | `404 image_not_found` |
| Original blob missing, no cached thumb | `productImagesStore.get(blob_key) === null` and no thumb | `404 source_missing` |
| Original blob missing, but cached thumb present | thumb hit before source check | `200 webp` (serve from cache) |
| `Jimp.read` or `getBufferAsync` throws | try/catch around the resize block | `200` original bytes + original Content-Type + `max-age=300` |
| `thumbnailsStore.set` throws after successful resize | inner try/catch around `.set` only | `console.warn` and serve the just-generated thumb anyway |
| DB query fails | uncaught | `500` (consistent with rest of codebase) |
| Auth failure | `authenticateForPermission` returns `Response` | propagated as-is |

`console.warn` is emitted on every fallback path with `{ image_id, reason }`. No new audit op — read-only and not security-relevant.

## Cache & invalidation

- Thumbnails are content-addressed by `blob_key`, which is immutable for the row's lifetime.
- "Replace image" flow does not exist today — replacement is DELETE + new POST, which mints a fresh `blob_key`.
- DELETE handler removes the cached thumb best-effort. An orphaned thumb after a failed delete is acceptable — same orphaning policy as the source blob.
- `immutable` in Cache-Control is honest for the success path.

## Tenant isolation

- Caller only supplies `image_id`. SQL join `product_images pi JOIN products p ON p.id = pi.product_id` filtered by `pi.id = $1 AND p.client_id = $2` is the sole tenant gate.
- A guessed UUID for another client's image returns 404 — no blob is read, no signal leaks.
- Thumb blob key embeds the original blob key which embeds `clientId`, so cross-tenant key collision is structurally impossible.
- L1 owner bypass (level_number == null || === 1) is inherited from `authenticateForPermission` — no extra handling.

## Testing

### Unit (`tests/unit/products-image-thumb.test.ts`)

- `productThumbKeyFor(blobKey)` returns `thumb/<input>.webp`; idempotent.
- 405 on POST/PUT/DELETE/PATCH.
- 400 on malformed UUID in path.
- 401 when auth fails (mocked).

### Integration (`tests/integration/products-image-thumb.test.ts`)

Uses the existing test DB fixture pattern + in-memory Blobs mock (mirror `tests/integration/u-products-image.test.ts` if present, else `files-thumbnail` patterns).

1. **Cache hit returns stored thumbnail** — pre-seed thumb store; assert 200 webp, body matches seed.
2. **Cache miss generates, stores, serves** — seed original blob with a real 800×600 PNG fixture; assert 200 webp, thumb blob now exists, max edge ≤240.
3. **Subsequent request hits cache** — assert source blob NOT re-read (spy), thumb `.get` called once.
4. **Cross-tenant 404** — image belongs to client A, JWT for client B; assert 404, no blob reads.
5. **403 without permission** — JWT with empty matrix at level_number=2; assert 403.
6. **L1 owner with empty matrix succeeds** — level_number=1, perms={}; assert 200 (matches server bypass).
7. **Corrupt source falls back to original** — seed original blob with garbage bytes that Jimp can't decode; assert 200 with original Content-Type, `max-age=300`.
8. **Missing source returns 404** — row exists, blob missing, no cached thumb; assert `404 source_missing`.
9. **Missing source but cached thumb still serves** — assert 200 webp from cache.
10. **Image deletion removes cached thumb** — generate thumb, DELETE image, assert thumb blob absent.

### Manual FE smoke

- Upload an image to a product; verify table row shows the thumb.
- Open product edit; verify gallery tiles show thumbs.
- Below-the-fold rows show `loading="lazy"` deferral.
- Network panel: first thumb request ~200–500 ms; subsequent ~30–80 ms; both `Cache-Control` headers correct.

## Performance budget (documented, not asserted in CI)

- Cold path (resize 4 MB PNG via sharp): ≤80 ms
- Warm path (cache hit): ≤50 ms
- If cold path regresses past 500 ms, suspect sharp version drift or a missing `external_node_modules` entry causing a JS fallback path.

## Risks & follow-ups

- **Sharp native binary deploy risk** — same class as `@node-rs/argon2`. Mitigated by adding `"sharp"` to `external_node_modules` in `netlify.toml`. Direct CLI deploys (`netlify deploy --prod --dir dist`) cannot ship native binaries — same restriction already documented in `feedback_netlify_cache_clear` for argon2. Use CI builds only.
- **Sharp version pinning** — sharp's libvips bindings can break across minor versions. Pin to `^0.33.x` and re-validate on upgrade.
- **No retina source for the gallery** — at 240 px, gallery tiles up to ~120 px are crisp on retina but a 200 px tile could look slightly soft. Acceptable for Phase B; revisit if users complain.
- **Multi-size endpoint** — `?size=sm|md` is the obvious extension if a future consumer needs it. Not designed in today.

## Plan reference

Implementation plan to be written at `docs/superpowers/plans/2026-06-09-product-image-thumbnails.md` by the `superpowers:writing-plans` skill in the next step.
