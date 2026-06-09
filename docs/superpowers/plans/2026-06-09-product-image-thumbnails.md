# Product Image Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /api/u-products-image-thumb/:image_id` that lazily generates 240px webp thumbnails for product images, caches them to a new Netlify Blob store, and renders them in `ProductTable` and `ProductImageGallery` in place of the current `.pm-thumb-placeholder` tiles.

**Architecture:** Single Netlify Function handler + small storage helper. Cache key derived from immutable source `blob_key` — no schema migration. Resize via `jimp` (pure JS, no native deps). Falls back to streaming the original on resize failure. Frontend swaps placeholders for `<img>` via new `imagesApi.thumbUrl(id)` helper.

**Tech Stack:** TypeScript, Netlify Functions v2, `@netlify/blobs`, `jimp` (new dep), Neon `@neondatabase/serverless`, Vitest. Frontend: React 18 + react-router-dom.

**Spec:** `docs/superpowers/specs/2026-06-09-product-image-thumbnails-design.md`

**Binding repo rules:**
- Never `git push` without user approval.
- Never `gh pr create` (burns Netlify preview build credits).
- Implementer verification at end of every task = `npm run typecheck` + `npm run lint` (if a lint script exists; if not, skip silently) + the specific test command for the task.
- Commit at the end of every task; do not batch commits.

**Branch:** Work directly on `main` unless the user opts otherwise. (No long-lived branch needed for a contained Phase B feature.)

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `netlify/functions/u-products-image-thumb.ts` | Endpoint handler: auth, tenant lookup, cache hit/miss, resize, fallback. |
| `netlify/functions/_shared/products-thumbnails.ts` | Blob store accessor + key derivation + constants (`THUMB_MAX_EDGE`, `THUMB_QUALITY`, `THUMB_CACHE_SECONDS`, `THUMB_FALLBACK_CACHE_SECONDS`). |
| `tests/unit/products-thumbnails.test.ts` | Unit tests for the pure helpers in `products-thumbnails.ts`. |
| `tests/integration/u-products-image-thumb.test.ts` | Integration tests for the endpoint. |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `jimp` to `dependencies`. |
| `netlify/functions/u-products-image.ts` | DELETE handler best-effort removes cached thumbnail via `productThumbKeyFor(blob_key)`. |
| `netlify/functions/u-products.ts` | List SELECT joins `product_images` by `(product_id, blob_key)` to expose `hero_image_id`. |
| `src/modules/products/shared/types.ts` | Add `hero_image_id: string \| null` to `ProductListRow`. |
| `src/modules/products/shared/api.ts` | Add `imagesApi.thumbUrl(image_id: string): string`. |
| `src/modules/products/workspace/components/ProductTable.tsx` | Replace `.pm-thumb-placeholder` with `<img>` driven by `hero_image_id`. |
| `src/modules/products/workspace/components/ProductImageGallery.tsx` | Replace `.pm-thumb-placeholder` with `<img>` driven by `im.id`. |
| `src/lib/components.css` | Ensure `.pm-thumb { object-fit: cover; width: 100%; height: 100%; }`. |

---

## Task 1: Add `jimp` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add jimp to dependencies**

Run from repo root:

```bash
npm install jimp@^0.22.12 --save-exact
```

Expected: `package.json` `dependencies` now contains `"jimp": "0.22.12"`. `package-lock.json` updated. No native binaries pulled (jimp is pure JS).

- [ ] **Step 2: Verify typecheck still passes**

```bash
npm run typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 3: Quick smoke that jimp resolves and resizes a tiny image**

Create a one-off scratch file at `/tmp/jimp-smoke.mjs`:

```js
import Jimp from 'jimp';
const img = await new Jimp(8, 8, 0xff0000ff);
const out = await img.scaleToFit(4, 4, Jimp.RESIZE_BEZIER).getBufferAsync(Jimp.MIME_WEBP);
console.log('ok bytes=', out.length);
```

```bash
node /tmp/jimp-smoke.mjs
```

Expected output: `ok bytes= <some positive integer>`. Delete the scratch file:

```bash
rm /tmp/jimp-smoke.mjs
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(products): add jimp dep for thumbnail resize

Pure-JS image library — avoids the native-binary deploy class of bug
that @node-rs/argon2 already taught us about.
EOF
)"
```

---

## Task 2: Storage helper module

**Files:**
- Create: `netlify/functions/_shared/products-thumbnails.ts`
- Create: `tests/unit/products-thumbnails.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/products-thumbnails.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  productThumbKeyFor,
  THUMB_MAX_EDGE,
  THUMB_QUALITY,
  THUMB_CACHE_SECONDS,
  THUMB_FALLBACK_CACHE_SECONDS,
} from '../../netlify/functions/_shared/products-thumbnails';

describe('products-thumbnails helpers', () => {
  test('productThumbKeyFor prefixes with thumb/ and suffixes .webp', () => {
    const src = 'product-images/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/cccccccc-cccc-cccc-cccc-cccccccccccc';
    expect(productThumbKeyFor(src)).toBe(`thumb/${src}.webp`);
  });

  test('productThumbKeyFor is idempotent in spirit — calling on its own result is detectable as already-prefixed but does not double-prefix because callers must only pass source keys', () => {
    // The function does not defensively un-double. Callers MUST pass a source
    // blob_key, never a thumb key. This test pins the contract.
    const src = 'product-images/a/b/c';
    const once = productThumbKeyFor(src);
    expect(once.startsWith('thumb/')).toBe(true);
    expect(once.endsWith('.webp')).toBe(true);
    // Double-prefix is a bug at the call site if it happens; we just document.
    expect(productThumbKeyFor(once)).toBe(`thumb/${once}.webp`);
  });

  test('constants have the expected values', () => {
    expect(THUMB_MAX_EDGE).toBe(240);
    expect(THUMB_QUALITY).toBe(80);
    expect(THUMB_CACHE_SECONDS).toBe(2_592_000); // 30 days
    expect(THUMB_FALLBACK_CACHE_SECONDS).toBe(300); // 5 minutes
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/unit/products-thumbnails.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create the helper**

Create `netlify/functions/_shared/products-thumbnails.ts`:

```ts
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
```

- [ ] **Step 4: Run unit tests — expect pass**

```bash
npx vitest run tests/unit/products-thumbnails.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/products-thumbnails.ts tests/unit/products-thumbnails.test.ts
git commit -m "$(cat <<'EOF'
feat(products): add thumbnails storage helper

Dedicated 'product-image-thumbnails' Netlify Blob store + content-addressed
key derivation. Constants for size (240px), quality (80), and cache TTLs.
EOF
)"
```

---

## Task 3: Endpoint — auth + method/path validation

**Files:**
- Create: `netlify/functions/u-products-image-thumb.ts`
- Create: `tests/integration/u-products-image-thumb.test.ts`

The integration test file's bootstrap mirrors the pattern already established in `tests/integration/u-products-image.test.ts`. We're building it up incrementally — Task 3 adds the bootstrap + auth-shape tests; Tasks 4–7 add behavior tests.

- [ ] **Step 1: Scaffold the integration test file with bootstrap + first three tests**

Create `tests/integration/u-products-image-thumb.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

// In-memory Blobs mock for both the source images store and the thumbnails
// store. Mirrors the pattern in tests/integration/u-products-image.test.ts.
const sourceStore = new Map<string, ArrayBuffer>();
const thumbStore  = new Map<string, ArrayBuffer>();

vi.mock('../../netlify/functions/_shared/products-storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/products-storage')>();
  return {
    ...original,
    productImagesStore: () => ({
      set:    async (key: string, data: ArrayBuffer) => { sourceStore.set(key, data); },
      get:    async (key: string) => sourceStore.get(key) ?? null,
      delete: async (key: string) => { sourceStore.delete(key); },
      getMetadata: async (key: string) => sourceStore.has(key) ? { etag: 'mock', metadata: {} } : null,
    }),
  };
});

vi.mock('../../netlify/functions/_shared/products-thumbnails', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/products-thumbnails')>();
  return {
    ...original,
    productThumbnailsStore: () => ({
      set:    async (key: string, data: ArrayBuffer) => { thumbStore.set(key, data); },
      get:    async (key: string) => thumbStore.get(key) ?? null,
      delete: async (key: string) => { thumbStore.delete(key); },
      getMetadata: async (key: string) => thumbStore.has(key) ? { etag: 'mock', metadata: {} } : null,
    }),
  };
});

import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientRolesHandler from '../../netlify/functions/client-roles';
import clientLevelsHandler from '../../netlify/functions/client-levels';
import userNodesHandler from '../../netlify/functions/user-nodes';
import uLoginHandler from '../../netlify/functions/u-login';
import uProductsHandler from '../../netlify/functions/u-products';
import uProductsImageHandler from '../../netlify/functions/u-products-image';
import uProductsImageThumbHandler from '../../netlify/functions/u-products-image-thumb';

const CTX = {} as Context;
const ADMIN_EMAIL = 'pm-thumb-admin@example.com';
const ADMIN_PASSWORD = 'pm-thumb-pw';

let sql: ReturnType<typeof neon>;
let adminCookie: string;
let clientId: string;
let clientSlug: string;
let roleId: string;
let buCookie: string;
const createdClients: string[] = [];

async function adminLogin(): Promise<string> {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const r = await loginHandler(new Request('http://localhost/api/auth-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

async function bootBucketUser(): Promise<string> {
  const email = `pm-th-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'pm-th-pw-123';
  await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role_id: roleId, level_number: 1, parent_id: null, display_name: 'Th User', email, create_login: true, temp_password: password }),
  }), CTX);
  const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${clientSlug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  }), CTX);
  return lr.headers.get('set-cookie')!.split(';')[0]!;
}

async function makeProduct(): Promise<{ id: string }> {
  const r = await uProductsHandler(new Request('http://localhost/api/u-products', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: buCookie },
    body: JSON.stringify({ type: 'physical', name: `P-${Date.now()}`, price_cents: 100 }),
  }), CTX);
  return r.json() as Promise<{ id: string }>;
}

/** A 32×16 solid-red PNG (real bytes — Jimp must be able to decode it). */
function realPngBytes(): Uint8Array {
  // 32x16 red, generated with: node -e "..." — base64 inline so the test has no fixtures dep.
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAYAAAB3AH1ZAAAAGklEQVR4nGP8z8DwnwEHYBxVOKpwVCElCgEZmwIBPgT8DwAAAABJRU5ErkJggg==';
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

async function uploadImage(productId: string, bytes: Uint8Array = realPngBytes(), mime = 'image/png'): Promise<{ id: string; blob_key: string }> {
  const fd = new FormData();
  fd.append('product_id', productId);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  fd.append('file', new Blob([ab], { type: mime }), 'img.png');
  const r = await uProductsImageHandler(new Request('http://localhost/api/u-products-image', {
    method: 'POST', headers: { cookie: buCookie }, body: fd,
  }), CTX);
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; blob_key: string };
}

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Th Admin', true)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, is_bootstrap = true
  `;
});

beforeEach(async () => {
  sourceStore.clear();
  thumbStore.clear();
  adminCookie = await adminLogin();
  const cr = await clientsHandler(new Request('http://localhost/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: `Th Test ${Date.now()}` }),
  }), CTX);
  const cb = (await cr.json()) as { client: { id: string; slug: string } };
  clientId = cb.client.id; clientSlug = cb.client.slug; createdClients.push(clientId);
  const rr = await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
  }), CTX);
  roleId = ((await rr.json()) as { role: { id: string } }).role.id;
  await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${clientId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ level_number: 1, allowed_role_ids: [roleId] }),
  }), CTX);
  buCookie = await bootBucketUser();
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

describe('u-products-image-thumb — auth + method + path', () => {
  test('405 on POST', async () => {
    const r = await uProductsImageThumbHandler(
      new Request('http://localhost/api/u-products-image-thumb/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        { method: 'POST', headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(405);
  });

  test('400 on malformed UUID', async () => {
    const r = await uProductsImageThumbHandler(
      new Request('http://localhost/api/u-products-image-thumb/not-a-uuid',
        { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(400);
  });

  test('401 without session cookie', async () => {
    const r = await uProductsImageThumbHandler(
      new Request('http://localhost/api/u-products-image-thumb/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
      CTX,
    );
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test — expect failure (handler doesn't exist)**

```bash
npx vitest run tests/integration/u-products-image-thumb.test.ts
```

Expected: FAIL with module not found for `u-products-image-thumb`.

- [ ] **Step 3: Create the handler skeleton**

Create `netlify/functions/u-products-image-thumb.ts`:

```ts
// GET /api/u-products-image-thumb/:image_id
//
// Lazy 240px webp thumbnails for product images. Cache hit ➜ serve.
// Cache miss ➜ read source, resize via jimp, write cache, serve.
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
    SELECT pi.blob_key, pi.product_id
    FROM public.product_images pi
    JOIN public.products p ON p.id = pi.product_id
    WHERE pi.id = ${id}::uuid AND p.client_id = ${clientId}::uuid AND p.deleted_at IS NULL
    LIMIT 1
  `) as Array<{ blob_key: string; product_id: string }>;
  if (rows.length === 0) return jsonError(404, 'image_not_found');
  const { blob_key } = rows[0]!;

  // Stub for Task 4. Forces the failing test for cache-hit to drive the next step.
  return jsonError(501, 'not_implemented');
  void productImagesStore; void productThumbnailsStore; void productThumbKeyFor;
  void THUMB_CACHE_SECONDS; void THUMB_FALLBACK_CACHE_SECONDS; void blob_key;
};
```

Note: the `void` lines exist only to silence "unused import" lint warnings while we're building incrementally. They are removed in Task 4 when the imports are actually consumed.

- [ ] **Step 4: Run integration test — expect pass on the three auth/path tests**

```bash
npx vitest run tests/integration/u-products-image-thumb.test.ts
```

Expected: 3 passing (`405 on POST`, `400 on malformed UUID`, `401 without session cookie`). Note: the bucket-user reaches the SQL lookup and gets 404 for a random UUID, but the bucket-user is auth'd — so the 401 test must use NO cookie (already in the test).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/u-products-image-thumb.ts tests/integration/u-products-image-thumb.test.ts
git commit -m "$(cat <<'EOF'
feat(products): thumbnails endpoint skeleton

Auth + tenant-isolated SQL lookup. Returns 501 from inside the handler
to drive the cache/resize implementation in the next commit.
EOF
)"
```

---

## Task 4: Cache hit + cache miss generate-resize-cache-serve

**Files:**
- Modify: `netlify/functions/u-products-image-thumb.ts`
- Modify: `tests/integration/u-products-image-thumb.test.ts`

- [ ] **Step 1: Append happy-path tests**

Add to the bottom of `tests/integration/u-products-image-thumb.test.ts`:

```ts
describe('u-products-image-thumb — happy path', () => {
  test('cache miss generates, stores, and serves a webp', async () => {
    const p = await makeProduct();
    const img = await uploadImage(p.id);
    const r = await uProductsImageThumbHandler(
      new Request(`http://localhost/api/u-products-image-thumb/${img.id}`, { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/webp');
    expect(r.headers.get('cache-control')).toContain('immutable');
    // Thumb is now cached.
    const cached = thumbStore.get(`thumb/${img.blob_key}.webp`);
    expect(cached).toBeDefined();
    expect(cached!.byteLength).toBeGreaterThan(0);
  });

  test('cache hit returns stored thumbnail without re-reading source', async () => {
    const p = await makeProduct();
    const img = await uploadImage(p.id);
    // Pre-seed the cache; then delete the source so we KNOW a cache hit served us.
    const sentinel = new TextEncoder().encode('CACHED-THUMB-BYTES').buffer;
    thumbStore.set(`thumb/${img.blob_key}.webp`, sentinel);
    sourceStore.delete(img.blob_key);

    const r = await uProductsImageThumbHandler(
      new Request(`http://localhost/api/u-products-image-thumb/${img.id}`, { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/webp');
    const body = new Uint8Array(await r.arrayBuffer());
    expect(new TextDecoder().decode(body)).toBe('CACHED-THUMB-BYTES');
  });
});
```

- [ ] **Step 2: Run tests — expect both new ones to fail with 501**

```bash
npx vitest run tests/integration/u-products-image-thumb.test.ts
```

Expected: 2 failures from the happy-path describe (status 501, expected 200).

- [ ] **Step 3: Implement cache check + lazy resize**

Replace the body of `netlify/functions/u-products-image-thumb.ts` (everything after the SQL lookup block) with:

```ts
  // (continuation — replaces the 501 stub from Task 3)
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

  // Resize via jimp. Lazy-import so the handler still type-checks if the lib
  // is missing — the actual call will throw and trip the fallback. Tasks 5+6
  // exercise both branches.
  try {
    const Jimp = (await import('jimp')).default;
    const image = await Jimp.read(Buffer.from(sourceBytes));
    image.scaleToFit(240, 240, Jimp.RESIZE_BEZIER).quality(80);
    const webp = await image.getBufferAsync(Jimp.MIME_WEBP);
    try {
      await thumbStore.set(thumbKey, webp);
    } catch (e) {
      // Cache write failed — serve the freshly-resized bytes anyway.
      console.warn('u-products-image-thumb: cache write failed', { image_id: id, reason: String(e) });
    }
    return new Response(webp, {
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
```

**Important:** delete the `void` lines and the `return jsonError(501, 'not_implemented');` from the Task 3 stub. The final handler is a single linear function with the auth/path/SQL block (from Task 3) followed by this body.

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run tests/integration/u-products-image-thumb.test.ts
```

Expected: 5 passing (3 from Task 3 + 2 new).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/u-products-image-thumb.ts tests/integration/u-products-image-thumb.test.ts
git commit -m "$(cat <<'EOF'
feat(products): thumbnails endpoint — cache hit + lazy resize

Reads source from product-images blob store, resizes to 240px webp via
jimp, caches to product-image-thumbnails, serves with 30d immutable
cache headers. Cache writes are best-effort.
EOF
)"
```

---

## Task 5: Failure paths — corrupt source fallback + missing source 404 + cached thumb with missing source

**Files:**
- Modify: `tests/integration/u-products-image-thumb.test.ts`

- [ ] **Step 1: Add failure-path tests**

Append to `tests/integration/u-products-image-thumb.test.ts`:

```ts
describe('u-products-image-thumb — failure paths', () => {
  test('corrupt source bytes fall back to original with short cache', async () => {
    const p = await makeProduct();
    const img = await uploadImage(p.id);
    // Overwrite source with garbage — jimp.read will throw.
    const garbage = new ArrayBuffer(16);
    new Uint8Array(garbage).fill(0x00);
    sourceStore.set(img.blob_key, garbage);

    const r = await uProductsImageThumbHandler(
      new Request(`http://localhost/api/u-products-image-thumb/${img.id}`, { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('max-age=300');
    expect(r.headers.get('cache-control')).not.toContain('immutable');
    // Body is the garbage we put in.
    const out = new Uint8Array(await r.arrayBuffer());
    expect(out.byteLength).toBe(16);
    // No cached thumb was written.
    expect(thumbStore.has(`thumb/${img.blob_key}.webp`)).toBe(false);
  });

  test('missing source with no cached thumb returns 404 source_missing', async () => {
    const p = await makeProduct();
    const img = await uploadImage(p.id);
    sourceStore.delete(img.blob_key);
    // No pre-seed of thumbStore.
    const r = await uProductsImageThumbHandler(
      new Request(`http://localhost/api/u-products-image-thumb/${img.id}`, { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(404);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('source_missing');
  });

  test('missing source but cached thumb still serves cached bytes', async () => {
    const p = await makeProduct();
    const img = await uploadImage(p.id);
    sourceStore.delete(img.blob_key);
    const seed = new TextEncoder().encode('CACHED').buffer;
    thumbStore.set(`thumb/${img.blob_key}.webp`, seed);

    const r = await uProductsImageThumbHandler(
      new Request(`http://localhost/api/u-products-image-thumb/${img.id}`, { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
    const body = new Uint8Array(await r.arrayBuffer());
    expect(new TextDecoder().decode(body)).toBe('CACHED');
  });
});
```

- [ ] **Step 2: Run tests — expect pass (no code change)**

```bash
npx vitest run tests/integration/u-products-image-thumb.test.ts
```

Expected: 8 passing. The handler already implements all three behaviors from Task 4.

If any of the three fails, fix the handler — likely a control-flow bug between cache-check ordering and source-check ordering. Re-read the design's data-flow section.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/u-products-image-thumb.test.ts
git commit -m "$(cat <<'EOF'
test(products): cover thumbnail fallback paths

Corrupt-source ➜ stream original with 5min cache, no thumb stored.
Missing source no cache ➜ 404 source_missing.
Missing source with cache ➜ serve cached bytes (cache wins).
EOF
)"
```

---

## Task 6: Cross-tenant 404 + L1 owner bypass

**Files:**
- Modify: `tests/integration/u-products-image-thumb.test.ts`

- [ ] **Step 1: Add tenant + L1 bypass tests**

Append:

```ts
describe('u-products-image-thumb — tenant + permissions', () => {
  test('cross-tenant image lookup returns 404', async () => {
    // Make an image under the current (client A) bucket-user.
    const p = await makeProduct();
    const img = await uploadImage(p.id);

    // Spin up a SECOND client + bucket user and try to fetch client A's image id.
    const cr = await clientsHandler(new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: `Th Other ${Date.now()}` }),
    }), CTX);
    const otherClient = (await cr.json()) as { client: { id: string; slug: string } };
    createdClients.push(otherClient.client.id);

    const rr = await clientRolesHandler(new Request(`http://localhost/api/client-roles?client=${otherClient.client.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ key: 'owner', label: 'Owner', color: '#3b82f6' }),
    }), CTX);
    const otherRoleId = ((await rr.json()) as { role: { id: string } }).role.id;
    await clientLevelsHandler(new Request(`http://localhost/api/client-levels?client=${otherClient.client.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ level_number: 1, allowed_role_ids: [otherRoleId] }),
    }), CTX);
    const email = `pm-th-other-${Date.now()}@example.com`;
    const password = 'pm-th-other-pw-123';
    await userNodesHandler(new Request(`http://localhost/api/user-nodes?client=${otherClient.client.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ role_id: otherRoleId, level_number: 1, parent_id: null, display_name: 'Other', email, create_login: true, temp_password: password }),
    }), CTX);
    const lr = await uLoginHandler(new Request(`http://localhost/api/u-login?client=${otherClient.client.slug}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    }), CTX);
    const otherCookie = lr.headers.get('set-cookie')!.split(';')[0]!;

    const r = await uProductsImageThumbHandler(
      new Request(`http://localhost/api/u-products-image-thumb/${img.id}`, { headers: { cookie: otherCookie } }),
      CTX,
    );
    expect(r.status).toBe(404);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('image_not_found');
  });

  test('L1 owner with empty permissions matrix can view thumbnails', async () => {
    // Default seed makes the bucket user an L1 owner already — verify by
    // explicitly clearing the level matrix and confirming we still get a 200.
    await sql`UPDATE public.client_levels SET permissions = '{}'::jsonb WHERE client_id = ${clientId}::uuid AND level_number = 1`;
    const p = await makeProduct();
    const img = await uploadImage(p.id);
    const r = await uProductsImageThumbHandler(
      new Request(`http://localhost/api/u-products-image-thumb/${img.id}`, { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests — expect pass (no code change)**

```bash
npx vitest run tests/integration/u-products-image-thumb.test.ts
```

Expected: 10 passing. The handler's existing auth flow + SQL JOIN handles both cases.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/u-products-image-thumb.test.ts
git commit -m "$(cat <<'EOF'
test(products): tenant isolation + L1 owner bypass for thumbnails

Cross-tenant image lookup ➜ 404 image_not_found (no signal leak).
L1 owner with empty permission matrix ➜ 200 (matches server bypass).
EOF
)"
```

---

## Task 7: Delete cached thumb when source image is deleted

**Files:**
- Modify: `netlify/functions/u-products-image.ts`
- Modify: `tests/integration/u-products-image-thumb.test.ts`

- [ ] **Step 1: Add the deletion-cleanup test**

Append to `tests/integration/u-products-image-thumb.test.ts`:

```ts
describe('u-products-image DELETE — clears cached thumbnail', () => {
  test('DELETE on an image also removes its cached thumb', async () => {
    const p = await makeProduct();
    const img = await uploadImage(p.id);
    // Warm the cache.
    await uProductsImageThumbHandler(
      new Request(`http://localhost/api/u-products-image-thumb/${img.id}`, { headers: { cookie: buCookie } }),
      CTX,
    );
    expect(thumbStore.has(`thumb/${img.blob_key}.webp`)).toBe(true);

    // DELETE the image.
    const r = await uProductsImageHandler(
      new Request(`http://localhost/api/u-products-image/${img.id}`, { method: 'DELETE', headers: { cookie: buCookie } }),
      CTX,
    );
    expect(r.status).toBe(204);

    expect(thumbStore.has(`thumb/${img.blob_key}.webp`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/integration/u-products-image-thumb.test.ts -t "DELETE on an image also removes its cached thumb"
```

Expected: FAIL because `u-products-image.ts` DELETE handler doesn't clean up thumbs yet.

- [ ] **Step 3: Wire up the thumb deletion in u-products-image.ts**

In `netlify/functions/u-products-image.ts`:

Add the import alongside the existing storage import:

```ts
import { productThumbnailsStore, productThumbKeyFor } from './_shared/products-thumbnails';
```

Inside `handleDelete`, immediately after the existing `productImagesStore().delete(row.blob_key).catch(...)` call, add:

```ts
await productThumbnailsStore().delete(productThumbKeyFor(row.blob_key)).catch(() => { /* orphan tolerated */ });
```

The two `.catch(() => {})` calls sit back-to-back so both deletions are best-effort.

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/integration/u-products-image-thumb.test.ts -t "DELETE on an image also removes its cached thumb"
```

Expected: PASS.

- [ ] **Step 5: Run the full image + image-thumb test suites to confirm no regression**

```bash
npx vitest run tests/integration/u-products-image.test.ts tests/integration/u-products-image-thumb.test.ts
```

Expected: ALL passing (existing u-products-image cases + 11 thumb cases).

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/u-products-image.ts tests/integration/u-products-image-thumb.test.ts
git commit -m "$(cat <<'EOF'
feat(products): clear cached thumbnail on image DELETE

Best-effort delete via productThumbnailsStore — orphan tolerated, mirrors
the source-blob delete posture.
EOF
)"
```

---

## Task 8: List query — expose `hero_image_id` for the frontend

**Files:**
- Modify: `netlify/functions/u-products.ts`
- Modify: `src/modules/products/shared/types.ts`
- Modify: `tests/integration/u-products-list-create.test.ts` (extend with one assertion)

The frontend needs the image's UUID, not just its `blob_key`, to build `/api/u-products-image-thumb/:id` URLs. Add `hero_image_id` to the list response.

- [ ] **Step 1: Read the current list SELECT shape**

Open `netlify/functions/u-products.ts` and locate the two SELECT statements (around lines 95–96 and 174–175 per the previous exploration). They both look like:

```ts
SELECT id, type, name, description, category_id, brand, tags, price_cents,
       sku, stock_qty, unit, status, hero_image_key, created_at, updated_at
FROM ...
```

Note exact line numbers will drift across commits — use grep to find:

```bash
grep -n 'hero_image_key, created_at, updated_at' netlify/functions/u-products.ts
```

- [ ] **Step 2: Locate the FROM clause for the list query and add a LEFT JOIN**

The list query is inside `handleList`. Identify its `FROM public.products p` line and add immediately after it:

```sql
LEFT JOIN public.product_images pi_hero
  ON pi_hero.product_id = p.id AND pi_hero.blob_key = p.hero_image_key
```

And in the SELECT list, replace `hero_image_key,` (around line 96 in handleList) with `hero_image_key, pi_hero.id AS hero_image_id,`.

The counts query (around line 175) reads from `products` only — leave it alone; it does not return columns.

**Concretely, the list query after the change has this shape (excerpt):**

```ts
const list = await sql.query(`
  SELECT p.id, p.type, p.name, p.description, p.category_id, p.brand, p.tags, p.price_cents,
         p.sku, p.stock_qty, p.unit, p.status, p.hero_image_key, pi_hero.id AS hero_image_id,
         p.created_at, p.updated_at
  FROM public.products p
  LEFT JOIN public.product_images pi_hero
    ON pi_hero.product_id = p.id AND pi_hero.blob_key = p.hero_image_key
  WHERE ${where}
  ORDER BY p.${sort} ${order}
  LIMIT ${page_size} OFFSET ${(page - 1) * page_size}
`, params);
```

**Tactical note:** the existing query uses raw column names without the `p.` alias. Adding the JOIN forces qualification on `id` to disambiguate. If the existing query doesn't alias the products table — alias it (`FROM public.products p`) and prefix every existing column with `p.` to avoid ambiguity errors.

If the existing query uses tagged-template `sql\`\`` rather than `sql.query(...)`, mirror that style. Match what's already there.

- [ ] **Step 3: Update the TS type**

In `src/modules/products/shared/types.ts`, find the `ProductListRow` interface and add:

```ts
hero_image_id: string | null;
```

immediately after the existing `hero_image_key` line.

If the row also flows through any `Product` type used by detail endpoints, only add to the row type used by the LIST endpoint — detail endpoint can stay flat (the gallery has `images[].id` already).

- [ ] **Step 4: Extend an existing list test with the new field assertion**

Open `tests/integration/u-products-list-create.test.ts`. Find a happy-path "GET returns N items" test. Add an assertion that on a product with an uploaded image, the list row has `hero_image_id` as a UUID string. Sketch:

```ts
test('list returns hero_image_id for products with images', async () => {
  // assumes the test already creates a product `p` and uploads an image `img`
  // — if not, do so via the existing helpers in the file.
  const r = await uProductsHandler(new Request('http://localhost/api/u-products', { headers: { cookie: buCookie } }), CTX);
  expect(r.status).toBe(200);
  const body = await r.json() as { items: Array<{ id: string; hero_image_id: string | null; hero_image_key: string | null }> };
  const row = body.items.find((i) => i.id === p.id)!;
  expect(row.hero_image_key).toBe(img.blob_key);
  expect(row.hero_image_id).toBe(img.id);
});

test('list returns null hero_image_id for products without images', async () => {
  const p2 = await makeProduct();
  const r = await uProductsHandler(new Request('http://localhost/api/u-products', { headers: { cookie: buCookie } }), CTX);
  const body = await r.json() as { items: Array<{ id: string; hero_image_id: string | null }> };
  const row = body.items.find((i) => i.id === p2.id)!;
  expect(row.hero_image_id).toBeNull();
});
```

If the test file's existing helpers (`makeProduct`, `uploadImage`, etc.) differ from the names above, follow what's already in that file. Do not invent new helpers.

- [ ] **Step 5: Run the list test — expect pass**

```bash
npx vitest run tests/integration/u-products-list-create.test.ts
```

Expected: existing tests still pass + two new ones pass.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: exits 0. If the new column flows through any other consumer (e.g., a transform layer in `api.ts`), update accordingly.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/u-products.ts src/modules/products/shared/types.ts tests/integration/u-products-list-create.test.ts
git commit -m "$(cat <<'EOF'
feat(products): expose hero_image_id in list response

LEFT JOIN on (product_id, blob_key) — blob_key is mint-fresh per upload
so the join is unique. Needed so the frontend can build
/api/u-products-image-thumb/:id URLs.
EOF
)"
```

---

## Task 9: Frontend — `imagesApi.thumbUrl()` helper

**Files:**
- Modify: `src/modules/products/shared/api.ts`

- [ ] **Step 1: Add the helper to imagesApi**

Open `src/modules/products/shared/api.ts`. The `imagesApi` object is at the bottom of the file. Add `thumbUrl` alongside `upload` and `remove`:

```ts
export const imagesApi = {
  upload: (product_id: string, file: File, sort_order?: number): Promise<ProductImageRow> => {
    const fd = new FormData();
    fd.append('product_id', product_id);
    if (sort_order != null) fd.append('sort_order', String(sort_order));
    fd.append('file', file);
    return formFetch('/api/u-products-image', fd);
  },
  remove: (image_id: string): Promise<void> =>
    jsonFetch<void>(`/api/u-products-image/${image_id}`, { method: 'DELETE' }),
  thumbUrl: (image_id: string): string =>
    `/api/u-products-image-thumb/${image_id}`,
};
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/modules/products/shared/api.ts
git commit -m "$(cat <<'EOF'
feat(products): imagesApi.thumbUrl(id) helper

Pure URL builder — no fetch — so consumers can drop it straight into
<img src> attrs.
EOF
)"
```

---

## Task 10: Frontend — `ProductTable` swaps placeholder for real `<img>`

**Files:**
- Modify: `src/modules/products/workspace/components/ProductTable.tsx`
- Modify: `src/lib/components.css` (only if `.pm-thumb` doesn't already cover sizing)

- [ ] **Step 1: Update ProductTable to render `<img>` when `hero_image_id` is set**

In `src/modules/products/workspace/components/ProductTable.tsx`, find the block:

```tsx
{p.hero_image_key
  ? <div className="pm-thumb pm-thumb-placeholder" title={p.hero_image_key} />
  : <div className="pm-thumb pm-thumb-empty" aria-hidden />
}
```

Replace with:

```tsx
{p.hero_image_id
  ? <img
      className="pm-thumb"
      src={imagesApi.thumbUrl(p.hero_image_id)}
      alt=""
      loading="lazy"
      decoding="async"
    />
  : <div className="pm-thumb pm-thumb-empty" aria-hidden />
}
```

Add the import at the top of the file:

```tsx
import { imagesApi } from '../../shared/api';
```

(If `imagesApi` is already imported, skip — just verify.)

- [ ] **Step 2: Verify CSS covers `<img>` shape**

Check `src/lib/components.css` for an existing `.pm-thumb` rule. If it doesn't include `object-fit: cover`, add a rule that ensures images of arbitrary aspect ratio look right:

```bash
grep -n '\.pm-thumb' src/lib/components.css
```

If the existing `.pm-thumb` rule sets width/height but no `object-fit`, append a line inside that rule:

```css
.pm-thumb {
  /* existing rules */
  object-fit: cover;
}
```

Don't duplicate the `.pm-thumb` selector — edit the existing block.

- [ ] **Step 3: Typecheck + dev-server smoke**

```bash
npm run typecheck
```

Expected: exits 0.

Manual smoke (only if dev server is already running per the handoff): visit `/c/<slug>/products` and confirm rows with images show actual thumbnails. If no dev server is running, skip — the dev-server smoke is a verification convenience, not a blocker.

- [ ] **Step 4: Commit**

```bash
git add src/modules/products/workspace/components/ProductTable.tsx src/lib/components.css
git commit -m "$(cat <<'EOF'
feat(products): render real thumbnails in list table

ProductTable swaps the .pm-thumb-placeholder for <img> sourced from
/api/u-products-image-thumb/:id with loading=lazy + decoding=async.
EOF
)"
```

---

## Task 11: Frontend — `ProductImageGallery` swaps placeholder for real `<img>`

**Files:**
- Modify: `src/modules/products/workspace/components/ProductImageGallery.tsx`

- [ ] **Step 1: Replace the placeholder div with an <img>**

In `ProductImageGallery.tsx`, the placeholder lives inside the `<div role="listitem" className="pm-img-tile...">` block:

```tsx
{/* No thumbnail endpoint exists yet — render the blob_key as a
    placeholder. The hero outline still shows which image was
    picked. Wiring real thumbnails is a follow-up. */}
<div className="pm-thumb pm-thumb-placeholder" style={{ width: '100%', height: '100%' }} />
```

Replace with:

```tsx
<img
  className="pm-thumb"
  style={{ width: '100%', height: '100%' }}
  src={imagesApi.thumbUrl(im.id)}
  alt=""
  loading="lazy"
  decoding="async"
/>
```

Confirm `imagesApi` is imported at the top of the file (it is, since the existing `imagesApi.remove(im.id)` call already uses it).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/modules/products/workspace/components/ProductImageGallery.tsx
git commit -m "$(cat <<'EOF'
feat(products): render real thumbnails in image gallery

ProductImageGallery swaps the .pm-thumb-placeholder for <img> sourced
from /api/u-products-image-thumb/:id.
EOF
)"
```

---

## Task 12: Final verification + manual FE smoke

**Files:**
- Run only — no edits unless something fails.

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: ALL test files pass. If a sibling test broke (e.g., `u-products-list-create.test.ts` because of the SELECT change), it's a regression — fix at the call site, not by reverting the change.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Lint, if a lint script exists**

```bash
test -f .eslintrc.cjs -o -f .eslintrc.json -o -f eslint.config.js && grep -q '"lint"' package.json && npm run lint || echo "no lint script — skipping"
```

Expected: exits 0 or the "no lint script" message. If lint errors appear, fix at the source — never `--no-verify`.

- [ ] **Step 4: Manual FE smoke (if a dev server is running per handoff)**

Per the handoff doc, this session may already have dev servers running on ports 5180 (Vite) and 8890 (Netlify dev). If they are running, in a browser:

- Visit `http://localhost:8890/c/<slug>/products`. Rows with images should show real thumbnails (small webp tiles), not gray placeholders.
- Click into a product with images. Gallery tiles should render the real thumbnails.
- Upload a new image. Refresh — the new row appears in gallery with its thumbnail, and (if it became hero) the list-table thumbnail updates.
- Open browser DevTools → Network. Initial request to `/api/u-products-image-thumb/<id>` should be 200, `content-type: image/webp`, `cache-control: public, max-age=2592000, immutable`. A reload of the same product should still 200 (server cache hit; browser may use disk cache and not re-request — both are fine).

If dev servers aren't running, skip — note in the final summary. The integration tests have already validated the endpoint.

- [ ] **Step 5: Confirm no uncommitted changes**

```bash
git status
```

Expected: working tree clean. If files were modified to fix lint/typecheck issues, commit them with an appropriate message before declaring done.

- [ ] **Step 6: Print summary of commits added by this plan**

```bash
git log --oneline -15
```

Expected: 11 new commits (one per task 1–11), most-recent first.

---

## Done criteria

- All 11 implementation commits land on `main`.
- `npm test` passes.
- `npm run typecheck` passes.
- The endpoint returns webp thumbnails for product images, and the FE table/gallery render them via `<img>`.
- No files in `git status` after the final commit.

## Out of scope (do NOT do)

- Do not `git push` — the user pushes manually per `feedback_no_push_without_approval`.
- Do not `gh pr create` — per `feedback_no_deploy_previews`.
- Do not add `jimp` to `netlify.toml`'s `external_node_modules` unless a build later fails (it shouldn't — jimp is pure JS).
- Do not run a migration — this feature is schema-free.
- Do not modify `Sidebar.tsx`, the AMS layout, or any admin route — that's the sibling spec's job.
- Do not edit any audit ops or schemas. No new audit op for thumbnail reads.
- Do not introduce a `?size=` query param — single 240px is the design.
