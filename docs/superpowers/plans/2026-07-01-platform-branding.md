# Platform Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a workspace-level Branding domain — logos (5 kinds), hero carousel, accent + auto-contrast, light/dark theme, self-hosted custom fonts — configured once by an L1 Owner and consumed by every customer-facing surface via a shared `BrandShell` + `GET /api/public/brand/:slug`.

**Architecture:** 11 `brand_*` columns on `public.clients` (migration 050); a backend `_shared/brand.ts` helper (blob store, magic-byte sniff, UUID-scoped key regex, module-agnostic slug resolver); two authed endpoints (multipart upload + partial PATCH) and two public endpoints (brand payload + ownership-validated image stream); a shared FE module `src/modules/branding/` (helpers, downscaler, self-hosted `@fontsource` fonts, `BrandShell`, `BrandHero`, `useBrand`, a shared `BrandingForm`, and bucket-user + admin card wrappers); CSS light-theme tokens; and two mounts mirroring the Workspace Backup card.

**Tech Stack:** TypeScript 5 (strict), Vitest (node default + per-file `jsdom` pragma for FE), Neon Postgres (`@neondatabase/serverless`), Netlify Functions v2, Netlify Blobs, React 18, `@fontsource*` self-hosted fonts.

**Spec:** `docs/superpowers/specs/2026-07-01-platform-branding-design.md` (this worktree). **ADR:** `docs/adr/0001-branding-is-a-platform-concern.md`. Read both before starting.

## Global Constraints

- **Worktree + branch:** `/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT` on `feat/platform-branding-iso`. **Before every commit run `git branch --show-current` and verify it equals `feat/platform-branding-iso`.** NO push, NO merge to main, NO `gh pr`.
- **Scope:** This plan builds the SHARED branding domain only. Do NOT touch `src/modules/pos/**`, `src/modules/booking/**`, or POS/Booking endpoints — the consume contract (spec §9) is a handback for those chats.
- **Verification gate (mandatory every task):** `npm run typecheck` must exit clean, and the task's tests must pass, BEFORE committing. Runtime script execution does not validate TS — always run `npm run typecheck`.
- **Blob store name:** `'brand'`. **Key shape:** `brand/<clientId>/<kind>` for the 5 stable kinds; `brand/<clientId>/hero/<slideUuid>` for hero slides. UUID-scoped so cross-tenant keys are structurally impossible.
- **Permission gate:** authed endpoints use `_platform.settings.edit` via `authenticateForPermission` (L1 Owner passes via the built-in L1 bypass in `requirePermission`).
- **Migration number:** `050` — verified collision-free (origin/main at 049; all unmerged worktrees behind main). Keep comments on their own line (the migrate splitter breaks on inline comments after `;`).
- **Netlify functions:** flat files under `netlify/functions/`; each new endpoint declares `export const config = { path: '…', method: '…' }`. No subfolders (discovery traps).
- **Import paths (verified on this branch):** `db` from `./_shared/db`; `jsonOk`/`jsonError` from `./_shared/http`; `authenticateForPermission`/`resolveClientIdOrRespond` from `./_shared/permissions`; `logAudit` from `./_shared/audit`; `clientIp`/`checkLimit` from `./_pub-ratelimit` (note: NOT under `_shared/`). Rate limiter signature: `checkLimit(ip: string, endpointKey: string, opts: { perMinute: number }) → Promise<{ ok: boolean; code?: string }>`.
- **`logAudit` signature:** `logAudit(sql, { session, op, clientId?, targetType?, targetId?, detail? })`.
- **No `sharp`, no new backend deps.** Image sizing is client-side (`downscale.ts`). Server keeps the 5 MB cap + magic-byte sniff as the authoritative guard.

---

## Task 1: Migration 050 — `brand_*` columns on `clients`

**Files:**
- Create: `db/migrations/050_brand_columns.sql`
- Test: `tests/integration/migration-050-brand.test.ts`

**Interfaces:**
- Produces: 11 columns on `public.clients` — `brand_logo_key`, `brand_logo_alt_key`, `brand_favicon_key`, `brand_app_icon_key`, `brand_social_key` (all `text` nullable), `brand_hero_keys` (`text[] NOT NULL DEFAULT '{}'`), `brand_accent` (`text` nullable), `brand_theme` (`text NOT NULL DEFAULT 'dark'` with CHECK in {dark,light}), `brand_font_heading`, `brand_font_body` (both `text` nullable). Named constraint `clients_brand_theme_chk`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/migration-050-brand.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

describe('migration 050 — brand_* columns on clients', () => {
  it('adds the five nullable *_key text columns', async () => {
    const rows = (await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients'
        AND column_name IN ('brand_logo_key','brand_logo_alt_key','brand_favicon_key','brand_app_icon_key','brand_social_key')
      ORDER BY column_name
    `) as Array<{ column_name: string; data_type: string; is_nullable: string }>;
    expect(rows).toHaveLength(5);
    for (const r of rows) { expect(r.data_type).toBe('text'); expect(r.is_nullable).toBe('YES'); }
  });

  it('adds brand_hero_keys as text[] NOT NULL default empty', async () => {
    const rows = (await sql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'brand_hero_keys'
    `) as Array<{ data_type: string; is_nullable: string; column_default: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data_type).toBe('ARRAY');
    expect(rows[0]!.is_nullable).toBe('NO');
  });

  it('adds brand_theme text NOT NULL default dark with a CHECK constraint', async () => {
    const col = (await sql`
      SELECT is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'brand_theme'
    `) as Array<{ is_nullable: string; column_default: string | null }>;
    expect(col[0]!.is_nullable).toBe('NO');
    expect(col[0]!.column_default ?? '').toContain('dark');
    const cons = (await sql`
      SELECT conname FROM pg_constraint WHERE conname = 'clients_brand_theme_chk'
    `) as Array<{ conname: string }>;
    expect(cons).toHaveLength(1);
  });

  it('adds brand_accent / brand_font_heading / brand_font_body nullable text', async () => {
    const rows = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients'
        AND column_name IN ('brand_accent','brand_font_heading','brand_font_body')
    `) as Array<{ column_name: string }>;
    expect(rows).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/migration-050-brand.test.ts`
Expected: FAIL (columns don't exist yet).

- [ ] **Step 3: Write the migration**

Create `db/migrations/050_brand_columns.sql`:

```sql
-- Migration 050: brand_* columns on public.clients.
-- Workspace-level branding namespace (ADR-0001): logos, hero carousel, accent,
-- theme, fonts. Consumed by every customer-facing surface via BrandShell.
-- Additive + idempotent. No data migration (POS v3 unmerged).
-- See docs/superpowers/specs/2026-07-01-platform-branding-design.md.

alter table public.clients
  add column if not exists brand_logo_key       text,
  add column if not exists brand_logo_alt_key   text,
  add column if not exists brand_favicon_key    text,
  add column if not exists brand_app_icon_key   text,
  add column if not exists brand_social_key     text,
  add column if not exists brand_hero_keys      text[]  not null default '{}',
  add column if not exists brand_accent         text,
  add column if not exists brand_theme          text    not null default 'dark',
  add column if not exists brand_font_heading   text,
  add column if not exists brand_font_body      text;

alter table public.clients
  drop constraint if exists clients_brand_theme_chk;

alter table public.clients
  add constraint clients_brand_theme_chk check (brand_theme in ('dark','light'));
```

- [ ] **Step 4: Apply the migration to the dev DB**

Run: `npm run migrate`
Expected: reports migration 050 applied (also applies any other pending migrations; that's expected).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/migration-050-brand.test.ts`
Expected: all 4 pass.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` (clean).

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add db/migrations/050_brand_columns.sql tests/integration/migration-050-brand.test.ts
git commit -m "feat(branding): migration 050 — brand_* columns on clients

11 additive columns: 5 stable image keys, brand_hero_keys text[],
brand_accent, brand_theme (CHECK dark|light), brand_font_heading/body.
No data migration (POS v3 unmerged).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `_shared/brand.ts` — store, keys, mime sniff, slug resolver

**Files:**
- Create: `netlify/functions/_shared/brand.ts`
- Test: `tests/unit/brand-shared.test.ts`

**Interfaces:**
- Consumes: `db` from `./db`; `getStore` from `@netlify/blobs`.
- Produces:
  - `BRAND_STORE_NAME = 'brand'`; `brandStore()` → Netlify Blobs store handle.
  - `BRAND_ALLOWED_MIME: Set<string>` = jpeg/png/webp; `MAX_BRAND_BYTES = 5*1024*1024`.
  - `type StableBrandKind = 'logo'|'logo_alt'|'favicon'|'app_icon'|'social'`; `type BrandKind = StableBrandKind|'hero'`.
  - `brandKey(clientId: string, kind: StableBrandKind): string`.
  - `heroKey(clientId: string, slideId: string): string`.
  - `isAllowedBrandKey(key: string): boolean`.
  - `keyBelongsToClient(key: string, clientId: string): boolean`.
  - `sniffImageMime(bytes: ArrayBuffer): string | null`.
  - `resolveClientBySlug(slug: string): Promise<{ clientId: string; name: string } | null>` — module-agnostic (NO storefront/POS gate).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/brand-shared.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  brandKey, heroKey, isAllowedBrandKey, keyBelongsToClient, sniffImageMime,
  BRAND_ALLOWED_MIME, MAX_BRAND_BYTES, BRAND_STORE_NAME,
} from '../../netlify/functions/_shared/brand';

const C = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SLIDE = '33333333-3333-4333-8333-333333333333';

describe('brand keys', () => {
  test('brandKey builds a stable per-kind key', () => {
    expect(brandKey(C, 'logo')).toBe(`brand/${C}/logo`);
    expect(brandKey(C, 'favicon')).toBe(`brand/${C}/favicon`);
  });
  test('heroKey embeds client + slide uuid', () => {
    expect(heroKey(C, SLIDE)).toBe(`brand/${C}/hero/${SLIDE}`);
  });
  test('isAllowedBrandKey accepts the 5 stable kinds + hero pattern', () => {
    for (const k of ['logo','logo_alt','favicon','app_icon','social']) {
      expect(isAllowedBrandKey(`brand/${C}/${k}`)).toBe(true);
    }
    expect(isAllowedBrandKey(`brand/${C}/hero/${SLIDE}`)).toBe(true);
  });
  test('isAllowedBrandKey rejects typos, traversal, missing uuid', () => {
    expect(isAllowedBrandKey(`brand/${C}/logoo`)).toBe(false);
    expect(isAllowedBrandKey(`brand/${C}/hero/not-a-uuid`)).toBe(false);
    expect(isAllowedBrandKey(`brand/../secret`)).toBe(false);
    expect(isAllowedBrandKey(`product-images/${C}/x`)).toBe(false);
    expect(isAllowedBrandKey('')).toBe(false);
  });
  test('keyBelongsToClient compares the embedded client uuid', () => {
    expect(keyBelongsToClient(`brand/${C}/logo`, C)).toBe(true);
    expect(keyBelongsToClient(`brand/${C}/hero/${SLIDE}`, C)).toBe(true);
    expect(keyBelongsToClient(`brand/${OTHER}/logo`, C)).toBe(false);
    expect(keyBelongsToClient('not-a-key', C)).toBe(false);
  });
});

describe('sniffImageMime', () => {
  const png  = new Uint8Array([0x89,0x50,0x4e,0x47,0,0,0,0,0,0,0,0]).buffer;
  const jpeg = new Uint8Array([0xff,0xd8,0xff,0,0,0,0,0,0,0,0,0]).buffer;
  const gif  = new Uint8Array([0x47,0x49,0x46,0,0,0,0,0,0,0,0,0]).buffer;
  const webp = new Uint8Array([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50]).buffer;
  const short = new Uint8Array([0x52,0x49,0x46]).buffer;
  test('detects png/jpeg/gif/webp', () => {
    expect(sniffImageMime(png)).toBe('image/png');
    expect(sniffImageMime(jpeg)).toBe('image/jpeg');
    expect(sniffImageMime(gif)).toBe('image/gif');
    expect(sniffImageMime(webp)).toBe('image/webp');
  });
  test('length-guards the webp check and returns null for unknown', () => {
    expect(sniffImageMime(short)).toBeNull();
    expect(sniffImageMime(new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12]).buffer)).toBeNull();
  });
});

describe('constants', () => {
  test('allowed mime set + cap + store name', () => {
    expect(BRAND_STORE_NAME).toBe('brand');
    expect(BRAND_ALLOWED_MIME.has('image/webp')).toBe(true);
    expect(BRAND_ALLOWED_MIME.has('image/gif')).toBe(false);
    expect(MAX_BRAND_BYTES).toBe(5 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/brand-shared.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `_shared/brand.ts`**

Create `netlify/functions/_shared/brand.ts`:

```ts
// Shared platform-branding helpers: blob store, key formats, magic-byte sniff,
// and a module-agnostic slug resolver. See ADR-0001 + the branding spec.
import { getStore } from '@netlify/blobs';
import { db } from './db';

export const BRAND_STORE_NAME = 'brand';
export const BRAND_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_BRAND_BYTES = 5 * 1024 * 1024;

export function brandStore() {
  return getStore({ name: BRAND_STORE_NAME, consistency: 'strong' });
}

export type StableBrandKind = 'logo' | 'logo_alt' | 'favicon' | 'app_icon' | 'social';
export type BrandKind = StableBrandKind | 'hero';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STABLE_KEY_RE = new RegExp(`^brand/(${UUID})/(logo|logo_alt|favicon|app_icon|social)$`, 'i');
const HERO_KEY_RE   = new RegExp(`^brand/(${UUID})/hero/${UUID}$`, 'i');

export function brandKey(clientId: string, kind: StableBrandKind): string {
  return `brand/${clientId}/${kind}`;
}

export function heroKey(clientId: string, slideId: string): string {
  return `brand/${clientId}/hero/${slideId}`;
}

export function isAllowedBrandKey(key: string): boolean {
  return STABLE_KEY_RE.test(key) || HERO_KEY_RE.test(key);
}

/** True iff `key` is a valid brand key whose embedded client uuid equals clientId. */
export function keyBelongsToClient(key: string, clientId: string): boolean {
  const m = STABLE_KEY_RE.exec(key) ?? HERO_KEY_RE.exec(key);
  return !!m && m[1]!.toLowerCase() === clientId.toLowerCase();
}

/** Magic-byte sniff (anti-spoof). Verbatim from POS v3. */
export function sniffImageMime(bytes: ArrayBuffer): string | null {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}

/**
 * Resolve a workspace slug to its client, WITHOUT any module-enablement gate.
 * Branding is module-agnostic — unlike _pub-authz.resolveStorefront which
 * requires POS + products to be enabled. Any workspace with a slug has a brand.
 */
export async function resolveClientBySlug(slug: string): Promise<{ clientId: string; name: string } | null> {
  if (!slug) return null;
  const sql = db();
  const rows = (await sql`
    SELECT id, name FROM public.clients WHERE slug = ${slug} LIMIT 1
  `) as Array<{ id: string; name: string }>;
  const c = rows[0];
  return c ? { clientId: c.id, name: c.name } : null;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/brand-shared.test.ts` → pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add netlify/functions/_shared/brand.ts tests/unit/brand-shared.test.ts
git commit -m "feat(branding): _shared/brand.ts — store, keys, mime sniff, resolver

Blob store 'brand'; UUID-scoped key regex (5 stable kinds + hero);
keyBelongsToClient cross-tenant guard; magic-byte sniff (verbatim from
POS v3); resolveClientBySlug with NO module-enablement gate (branding
is module-agnostic).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `POST /api/client-settings/brand-image` — authed upload

**Files:**
- Create: `netlify/functions/client-settings-brand-image.ts`
- Test: `tests/integration/client-settings-brand-image.test.ts`

**Interfaces:**
- Consumes: everything from Task 2; `authenticateForPermission`, `resolveClientIdOrRespond`, `logAudit`, `db`, `jsonOk`, `jsonError`.
- Produces: `POST /api/client-settings/brand-image`. Multipart `{ kind, file }` → `201 { key }`. Audit op `client.brand_image_uploaded`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/client-settings-brand-image.test.ts`. Mock the brand store in-memory (mirrors `tests/integration/u-products-image-thumb.test.ts`):

```ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

const blobStore = new Map<string, ArrayBuffer>();
vi.mock('../../netlify/functions/_shared/brand', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/brand')>();
  return {
    ...original,
    brandStore: () => ({
      set: async (key: string, data: ArrayBuffer) => { blobStore.set(key, data); },
      get: async (key: string) => blobStore.get(key) ?? null,
      delete: async (key: string) => { blobStore.delete(key); },
    }),
  };
});

import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import brandImageHandler from '../../netlify/functions/client-settings-brand-image';

const CTX = {} as Context;
const ADMIN_EMAIL = 'brand-img-admin@example.com';
const ADMIN_PASSWORD = 'brand-img-pw';
const sql = neon(process.env.DATABASE_URL!);
let adminCookie = '';
let clientId = '';
const createdClients: string[] = [];

// PNG magic bytes + filler.
function pngFile(): File {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return new File([bytes], 'logo.png', { type: 'image/png' });
}
// Declared png but JPEG magic bytes (spoof).
function spoofFile(): File {
  const bytes = new Uint8Array(64);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return new File([bytes], 'logo.png', { type: 'image/png' });
}
function multipart(kind: string, file: File | null): Request {
  const form = new FormData();
  form.set('kind', kind);
  if (file) form.set('file', file);
  return new Request(`http://x/api/client-settings/brand-image?client=${clientId}`, {
    method: 'POST', headers: { cookie: adminCookie }, body: form,
  });
}

beforeAll(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  await sql`INSERT INTO public.admins (email, password_hash, name)
            VALUES (${ADMIN_EMAIL}, ${await hashPassword(ADMIN_PASSWORD)}, 'Brand Img Admin')
            ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`;
  const lr = await loginHandler(new Request('http://x/api/auth-login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }), CTX);
  adminCookie = (lr.headers.get('set-cookie') ?? '').split(';')[0]!;
  const cr = await clientsHandler(new Request('http://x/api/clients', {
    method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Brand Img Co', slug: `brand-img-${Date.now()}` }),
  }), CTX);
  clientId = (await cr.json() as { id: string }).id;
  createdClients.push(clientId);
});

afterAll(async () => {
  for (const id of createdClients) await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`;
});

describe('POST /api/client-settings/brand-image', () => {
  test('uploads a logo → 201 with the stable key', async () => {
    const res = await brandImageHandler(multipart('logo', pngFile()), CTX);
    expect(res.status).toBe(201);
    const body = await res.json() as { key: string };
    expect(body.key).toBe(`brand/${clientId}/logo`);
  });

  test('uploads a hero → 201 with a hero/<uuid> key', async () => {
    const res = await brandImageHandler(multipart('hero', pngFile()), CTX);
    expect(res.status).toBe(201);
    const body = await res.json() as { key: string };
    expect(body.key).toMatch(new RegExp(`^brand/${clientId}/hero/[0-9a-f-]{36}$`));
  });

  test('rejects an invalid kind → 400', async () => {
    const res = await brandImageHandler(multipart('banner', pngFile()), CTX);
    expect(res.status).toBe(400);
  });

  test('rejects a spoofed mime (declared png, bytes jpeg... actually jpeg is allowed) → use a non-image', async () => {
    // Declare png, send bytes that sniff to null (not an allowed image).
    const bytes = new Uint8Array(64); bytes.set([0x00, 0x01, 0x02, 0x03], 0);
    const bad = new File([bytes], 'logo.png', { type: 'image/png' });
    const res = await brandImageHandler(multipart('logo', bad), CTX);
    expect(res.status).toBe(400);
  });

  test('missing file → 400', async () => {
    const res = await brandImageHandler(multipart('logo', null), CTX);
    expect(res.status).toBe(400);
  });

  test('no cookie → 401', async () => {
    const form = new FormData(); form.set('kind', 'logo'); form.set('file', pngFile());
    const res = await brandImageHandler(new Request(`http://x/api/client-settings/brand-image?client=${clientId}`, {
      method: 'POST', body: form,
    }), CTX);
    expect(res.status).toBe(401);
  });
});
```

Note: the `spoofFile` helper is unused in the final tests (JPEG is a valid image); the "non-image bytes" test covers the sniff-rejection path. Leave `spoofFile` out or keep it — the implementer may delete it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/client-settings-brand-image.test.ts`
Expected: FAIL (handler module not found).

- [ ] **Step 3: Implement the endpoint**

Create `netlify/functions/client-settings-brand-image.ts`:

```ts
// POST /api/client-settings/brand-image — authed brand image upload.
// Multipart { kind, file } → writes the blob, returns { key }. Gated by
// _platform.settings.edit (L1 Owners pass via requirePermission's L1 bypass).
// Does NOT touch clients — the PATCH endpoint stores the key. See branding spec §5.2.
import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { logAudit } from './_shared/audit';
import {
  brandStore, brandKey, heroKey, sniffImageMime,
  BRAND_ALLOWED_MIME, MAX_BRAND_BYTES, type BrandKind, type StableBrandKind,
} from './_shared/brand';

export const config = { path: '/api/client-settings/brand-image', method: 'POST' };

const STABLE: readonly StableBrandKind[] = ['logo', 'logo_alt', 'favicon', 'app_icon', 'social'];
function isBrandKind(v: unknown): v is BrandKind {
  return typeof v === 'string' && (v === 'hero' || (STABLE as readonly string[]).includes(v));
}

export default async (req: Request, _ctx?: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const auth = await authenticateForPermission(req, '_platform.settings.edit');
  if (auth instanceof Response) return auth;
  const scope = resolveClientIdOrRespond(auth, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) return jsonError(400, 'multipart_required');
  let form: FormData;
  try { form = await req.formData(); } catch { return jsonError(400, 'invalid_multipart'); }

  const kind = form.get('kind');
  const file = form.get('file');
  if (!isBrandKind(kind)) return jsonError(400, 'invalid_kind');
  if (!(file instanceof Blob)) return jsonError(400, 'file_required');
  if (!BRAND_ALLOWED_MIME.has(file.type)) return jsonError(400, 'unsupported_mime');
  if (file.size === 0) return jsonError(400, 'empty_file');
  if (file.size > MAX_BRAND_BYTES) return jsonError(413, 'file_too_large');

  const bytes = await file.arrayBuffer();
  const sniffed = sniffImageMime(bytes);
  if (!sniffed || !BRAND_ALLOWED_MIME.has(sniffed)) return jsonError(400, 'unsupported_mime');

  const key = kind === 'hero' ? heroKey(clientId, crypto.randomUUID()) : brandKey(clientId, kind);
  await brandStore().set(key, bytes);
  await logAudit(db(), {
    session: auth, op: 'client.brand_image_uploaded', clientId,
    targetType: 'client', targetId: clientId, detail: { kind, key },
  });
  return jsonOk({ key }, { status: 201 });
};
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/integration/client-settings-brand-image.test.ts` → pass.
Run: `npm run typecheck` → clean.

If the seed columns (`admins.name`, `clients` insert shape) differ from the test's assumptions, adjust the SEED to match the real schema (read `db/migrations/002_admins.sql` / `003_clients.sql`), never weaken the endpoint.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add netlify/functions/client-settings-brand-image.ts tests/integration/client-settings-brand-image.test.ts
git commit -m "feat(branding): POST /api/client-settings/brand-image

Authed multipart upload gated by _platform.settings.edit. Magic-byte
anti-spoof; stable kinds overwrite, hero mints a per-slide uuid.
Audit op client.brand_image_uploaded.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `PATCH /api/client-settings/brand` — partial update + cross-tenant guard

**Files:**
- Create: `netlify/functions/client-settings-brand.ts`
- Test: `tests/integration/client-settings-brand.test.ts`

**Interfaces:**
- Consumes: Task 2 (`isAllowedBrandKey`, `keyBelongsToClient`); auth + audit + db + http; `z` from `zod`.
- Produces: `PATCH /api/client-settings/brand`. Body: partial `{ logoKey?, logoAltKey?, faviconKey?, appIconKey?, socialKey?, heroKeys?, accent?, theme?, fontHeading?, fontBody? }`. `200 { ok: true }`. Audit op `client.brand_updated`. Error `400 forbidden_cross_tenant_key` when a supplied key's embedded uuid ≠ clientId.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/client-settings-brand.test.ts`. (Seed a client + admin cookie exactly as in Task 3's `beforeAll` — copy that block.) Core assertions:

```ts
// … same imports + brand store mock + beforeAll/afterAll seed as Task 3 …
import brandPatchHandler from '../../netlify/functions/client-settings-brand';

function patch(body: unknown): Request {
  return new Request(`http://x/api/client-settings/brand?client=${clientId}`, {
    method: 'PATCH', headers: { cookie: adminCookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/client-settings/brand', () => {
  test('partial update sets only supplied fields', async () => {
    const res = await brandPatchHandler(patch({ accent: '#3b82f6', theme: 'light' }), CTX);
    expect(res.status).toBe(200);
    const rows = (await sql`SELECT brand_accent, brand_theme, brand_font_body FROM public.clients WHERE id = ${clientId}::uuid`) as Array<{ brand_accent: string; brand_theme: string; brand_font_body: string | null }>;
    expect(rows[0]!.brand_accent).toBe('#3b82f6');
    expect(rows[0]!.brand_theme).toBe('light');
    expect(rows[0]!.brand_font_body).toBeNull();
  });

  test('stores an owned logo key', async () => {
    const key = `brand/${clientId}/logo`;
    const res = await brandPatchHandler(patch({ logoKey: key }), CTX);
    expect(res.status).toBe(200);
    const rows = (await sql`SELECT brand_logo_key FROM public.clients WHERE id = ${clientId}::uuid`) as Array<{ brand_logo_key: string }>;
    expect(rows[0]!.brand_logo_key).toBe(key);
  });

  test('replaces heroKeys atomically', async () => {
    const a = `brand/${clientId}/hero/${crypto.randomUUID()}`;
    const b = `brand/${clientId}/hero/${crypto.randomUUID()}`;
    const res = await brandPatchHandler(patch({ heroKeys: [a, b] }), CTX);
    expect(res.status).toBe(200);
    const rows = (await sql`SELECT brand_hero_keys FROM public.clients WHERE id = ${clientId}::uuid`) as Array<{ brand_hero_keys: string[] }>;
    expect(rows[0]!.brand_hero_keys).toEqual([a, b]);
  });

  test('rejects a bad hex accent → 400', async () => {
    expect((await brandPatchHandler(patch({ accent: '#zzz' }), CTX)).status).toBe(400);
  });

  test('rejects an invalid theme → 400', async () => {
    expect((await brandPatchHandler(patch({ theme: 'purple' }), CTX)).status).toBe(400);
  });

  test('rejects a foreign-tenant logo key → 400 forbidden_cross_tenant_key', async () => {
    const foreign = `brand/22222222-2222-4222-8222-222222222222/logo`;
    const res = await brandPatchHandler(patch({ logoKey: foreign }), CTX);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('forbidden_cross_tenant_key');
  });

  test('rejects a foreign-tenant hero key → 400', async () => {
    const foreign = `brand/22222222-2222-4222-8222-222222222222/hero/${crypto.randomUUID()}`;
    expect((await brandPatchHandler(patch({ heroKeys: [foreign] }), CTX)).status).toBe(400);
  });

  test('accepts null to clear a field', async () => {
    await brandPatchHandler(patch({ accent: '#3b82f6' }), CTX);
    const res = await brandPatchHandler(patch({ accent: null }), CTX);
    expect(res.status).toBe(200);
    const rows = (await sql`SELECT brand_accent FROM public.clients WHERE id = ${clientId}::uuid`) as Array<{ brand_accent: string | null }>;
    expect(rows[0]!.brand_accent).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/client-settings-brand.test.ts` → FAIL (handler missing).

- [ ] **Step 3: Implement the endpoint**

Create `netlify/functions/client-settings-brand.ts`:

```ts
// PATCH /api/client-settings/brand — authed partial brand update.
// Gated by _platform.settings.edit. Every supplied *_key / heroKeys element
// must belong to the acting tenant (cross-tenant guard). See branding spec §5.3.
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { logAudit } from './_shared/audit';
import { isAllowedBrandKey, keyBelongsToClient } from './_shared/brand';

export const config = { path: '/api/client-settings/brand', method: 'PATCH' };

const HEX = /^#[0-9a-fA-F]{6}$/;
const keyField = z.string().refine(isAllowedBrandKey, 'invalid_key').nullable();

const Body = z.object({
  logoKey:     keyField.optional(),
  logoAltKey:  keyField.optional(),
  faviconKey:  keyField.optional(),
  appIconKey:  keyField.optional(),
  socialKey:   keyField.optional(),
  heroKeys:    z.array(z.string().refine(isAllowedBrandKey, 'invalid_key')).optional(),
  accent:      z.string().regex(HEX).nullable().optional(),
  theme:       z.enum(['dark', 'light']).optional(),
  fontHeading: z.string().max(80).nullable().optional(),
  fontBody:    z.string().max(80).nullable().optional(),
}).strict();

// Maps request field → clients column.
const COL: Record<string, string> = {
  logoKey: 'brand_logo_key', logoAltKey: 'brand_logo_alt_key', faviconKey: 'brand_favicon_key',
  appIconKey: 'brand_app_icon_key', socialKey: 'brand_social_key', heroKeys: 'brand_hero_keys',
  accent: 'brand_accent', theme: 'brand_theme', fontHeading: 'brand_font_heading', fontBody: 'brand_font_body',
};

export default async (req: Request, _ctx?: Context) => {
  if (req.method !== 'PATCH') return jsonError(405, 'method_not_allowed');
  const auth = await authenticateForPermission(req, '_platform.settings.edit');
  if (auth instanceof Response) return auth;
  const scope = resolveClientIdOrRespond(auth, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  let parsed;
  try { parsed = Body.parse(await req.json()); }
  catch { return jsonError(400, 'validation_failed'); }

  // Cross-tenant guard on every supplied key.
  const keyFields: (keyof typeof parsed)[] = ['logoKey', 'logoAltKey', 'faviconKey', 'appIconKey', 'socialKey'];
  for (const f of keyFields) {
    const v = parsed[f];
    if (typeof v === 'string' && !keyBelongsToClient(v, clientId)) return jsonError(400, 'forbidden_cross_tenant_key');
  }
  if (parsed.heroKeys) {
    for (const k of parsed.heroKeys) if (!keyBelongsToClient(k, clientId)) return jsonError(400, 'forbidden_cross_tenant_key');
  }

  const entries = Object.entries(parsed).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return jsonOk({ ok: true });

  const sql = db();
  // Build a single UPDATE with dynamic SET. Neon's tagged template can't
  // interpolate identifiers, so assemble the fragment array and run sql.query.
  const sets = entries.map(([f], i) => `${COL[f]} = $${i + 1}`);
  const vals = entries.map(([, v]) => v);
  await sql.query(
    `UPDATE public.clients SET ${sets.join(', ')} WHERE id = $${vals.length + 1}`,
    [...vals, clientId],
  );

  await logAudit(sql, {
    session: auth, op: 'client.brand_updated', clientId,
    targetType: 'client', targetId: clientId,
    detail: { fields_changed: entries.map(([f]) => f) },
  });
  return jsonOk({ ok: true });
};
```

**Note on `sql.query`:** Neon's `neon()` client exposes a `.query(text, params)` method for parameterized non-template queries. Confirm the exact call shape against an existing dynamic-SQL usage in the repo during implementation (search `sql.query(` or `.query(`); if the project uses a different dynamic-update pattern, follow that instead — but keep the values parameterized (never string-concat `clientId` or values).

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/integration/client-settings-brand.test.ts` → pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add netlify/functions/client-settings-brand.ts tests/integration/client-settings-brand.test.ts
git commit -m "feat(branding): PATCH /api/client-settings/brand

Partial update of the 10 brand fields. Zod validation (hex accent,
theme enum, allowlisted key shape). Cross-tenant guard rejects any
key whose embedded uuid != acting client. Audit op client.brand_updated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `GET /api/public/brand/:slug` — public brand payload

**Files:**
- Create: `netlify/functions/pub-brand.ts`
- Test: `tests/integration/pub-brand.test.ts`

**Interfaces:**
- Consumes: Task 2 (`resolveClientBySlug`); `clientIp`/`checkLimit` from `./_pub-ratelimit`; `db`, `jsonError`.
- Produces: `GET /api/public/brand/:slug` → the `Brand` JSON payload (see spec §9.1). `Cache-Control: public, max-age=60`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/pub-brand.test.ts` (seed a client + set some brand columns directly via SQL; no cookie needed — endpoint is public):

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import pubBrandHandler from '../../netlify/functions/pub-brand';

const CTX = {} as Context;
const sql = neon(process.env.DATABASE_URL!);
let clientId = '';
let slug = '';
const created: string[] = [];

beforeAll(async () => {
  slug = `pub-brand-${Date.now()}`;
  const rows = (await sql`
    INSERT INTO public.clients (name, slug) VALUES ('Pub Brand Co', ${slug}) RETURNING id
  `) as Array<{ id: string }>;
  clientId = rows[0]!.id;
  created.push(clientId);
  await sql`UPDATE public.clients SET
    brand_logo_key = ${`brand/${clientId}/logo`},
    brand_hero_keys = ${sql.array?.([`brand/${clientId}/hero/${crypto.randomUUID()}`]) ?? [`brand/${clientId}/hero/${crypto.randomUUID()}`]},
    brand_accent = '#3b82f6', brand_theme = 'light', brand_font_heading = 'Inter'
    WHERE id = ${clientId}::uuid`;
});
afterAll(async () => { for (const id of created) await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; });

function get(s: string): Request {
  return new Request(`http://x/api/public/brand/${s}`, { method: 'GET', headers: { 'x-forwarded-for': '9.9.9.9' } });
}

describe('GET /api/public/brand/:slug', () => {
  test('known slug → 200 with full brand shape + cache header', async () => {
    const res = await pubBrandHandler(get(slug), CTX);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=60');
    const b = await res.json() as Record<string, unknown>;
    expect(b.name).toBe('Pub Brand Co');
    expect(b.theme).toBe('light');
    expect(b.accent).toBe('#3b82f6');
    expect(b.fontHeading).toBe('Inter');
    expect(b.logoUrl).toBe(`/api/public/brand/${slug}/image/brand/${clientId}/logo`);
    expect(Array.isArray(b.heroUrls)).toBe(true);
    expect((b.heroUrls as string[]).length).toBe(1);
    expect(b.logoAltUrl).toBeNull();
  });

  test('unknown slug → 404', async () => {
    expect((await pubBrandHandler(get('no-such-slug-xyz'), CTX)).status).toBe(404);
  });
});
```

Note: the `sql.array?.(...)` fallback is a hedge — during implementation, use whatever array-literal form the repo's Neon client accepts for a `text[]` insert (see how migration tests / booking seed arrays). If unsure, set `brand_hero_keys` with a plain JS array binding `${[...]}` which Neon serializes to a Postgres array.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/pub-brand.test.ts` → FAIL (handler missing).

- [ ] **Step 3: Implement the endpoint**

Create `netlify/functions/pub-brand.ts`:

```ts
// GET /api/public/brand/:slug — public, module-agnostic brand payload.
// Every customer-facing surface (POS storefront, Booking, …) fetches this and
// wraps its pages in <BrandShell>. See branding spec §5.4 + §9.
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveClientBySlug } from './_shared/brand';
import { clientIp, checkLimit } from './_pub-ratelimit';

export const config = { path: '/api/public/brand/:slug', method: 'GET' };

function slugFromUrl(req: Request): string {
  const segs = new URL(req.url).pathname.split('/').filter(Boolean); // /api/public/brand/<slug>
  return decodeURIComponent(segs[segs.length - 1] ?? '');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const rl = await checkLimit(clientIp(req), 'brand', { perMinute: 60 });
  if (!rl.ok) return jsonError(429, rl.code ?? 'rate_limited');

  const slug = slugFromUrl(req);
  const tenant = await resolveClientBySlug(slug);
  if (!tenant) return jsonError(404, 'not_found');

  const sql = db();
  const rows = (await sql`
    SELECT brand_logo_key, brand_logo_alt_key, brand_favicon_key, brand_app_icon_key,
           brand_social_key, brand_hero_keys, brand_accent, brand_theme,
           brand_font_heading, brand_font_body
    FROM public.clients WHERE id = ${tenant.clientId}::uuid LIMIT 1
  `) as Array<{
    brand_logo_key: string | null; brand_logo_alt_key: string | null; brand_favicon_key: string | null;
    brand_app_icon_key: string | null; brand_social_key: string | null; brand_hero_keys: string[];
    brand_accent: string | null; brand_theme: 'dark' | 'light';
    brand_font_heading: string | null; brand_font_body: string | null;
  }>;
  const r = rows[0]!;
  const url = (key: string | null) => key ? `/api/public/brand/${encodeURIComponent(slug)}/image/${key}` : null;

  const payload = {
    name: tenant.name,
    logoUrl:    url(r.brand_logo_key),
    logoAltUrl: url(r.brand_logo_alt_key),
    faviconUrl: url(r.brand_favicon_key),
    appIconUrl: url(r.brand_app_icon_key),
    socialUrl:  url(r.brand_social_key),
    heroUrls:   (r.brand_hero_keys ?? []).map((k) => url(k)!).filter(Boolean),
    accent:     r.brand_accent,
    theme:      r.brand_theme,
    fontHeading: r.brand_font_heading,
    fontBody:    r.brand_font_body,
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
  });
}
```

Note: the image URL intentionally embeds the key with its own slashes (`/image/brand/<clientId>/logo`). The image endpoint (Task 6) parses everything after `/image/` as the key. Do NOT `encodeURIComponent` the key here — the image handler splits on the literal path.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/integration/pub-brand.test.ts` → pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add netlify/functions/pub-brand.ts tests/integration/pub-brand.test.ts
git commit -m "feat(branding): GET /api/public/brand/:slug

Module-agnostic public brand payload (no POS gate). Maps stored keys to
/image/ URLs; 60s edge cache. 404 unknown slug; 429 rate-limited.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `GET /api/public/brand/:slug/image/:key` — ownership-validated image stream

**Files:**
- Create: `netlify/functions/pub-brand-image.ts`
- Test: `tests/integration/pub-brand-image.test.ts`

**Interfaces:**
- Consumes: Task 2 (`brandStore`, `isAllowedBrandKey`, `sniffImageMime`, `resolveClientBySlug`); rate limiter; `db`, `jsonError`.
- Produces: `GET /api/public/brand/:slug/image/:key` → image bytes; `Cache-Control: public, max-age=86400`; 404 on unowned/unknown-prefix/missing.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/pub-brand-image.test.ts`. Mock the brand store in-memory + seed a client with an owned logo key + blob:

```ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

const blobStore = new Map<string, ArrayBuffer>();
vi.mock('../../netlify/functions/_shared/brand', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../netlify/functions/_shared/brand')>();
  return {
    ...original,
    brandStore: () => ({
      set: async (k: string, d: ArrayBuffer) => { blobStore.set(k, d); },
      get: async (k: string) => blobStore.get(k) ?? null,
      delete: async (k: string) => { blobStore.delete(k); },
    }),
  };
});

import pubBrandImageHandler from '../../netlify/functions/pub-brand-image';

const CTX = {} as Context;
const sql = neon(process.env.DATABASE_URL!);
let clientId = '';
let slug = '';
let logoKey = '';
const created: string[] = [];

beforeAll(async () => {
  slug = `pub-img-${Date.now()}`;
  const rows = (await sql`INSERT INTO public.clients (name, slug) VALUES ('Pub Img Co', ${slug}) RETURNING id`) as Array<{ id: string }>;
  clientId = rows[0]!.id;
  created.push(clientId);
  logoKey = `brand/${clientId}/logo`;
  await sql`UPDATE public.clients SET brand_logo_key = ${logoKey} WHERE id = ${clientId}::uuid`;
  // PNG bytes into the mocked store.
  const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47], 0);
  blobStore.set(logoKey, png.buffer);
});
afterAll(async () => { for (const id of created) await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; });

function get(path: string): Request {
  return new Request(`http://x${path}`, { method: 'GET', headers: { 'x-forwarded-for': '8.8.8.8' } });
}

describe('GET /api/public/brand/:slug/image/:key', () => {
  test('owned key → 200 with 24h cache + sniffed content-type', async () => {
    const res = await pubBrandImageHandler(get(`/api/public/brand/${slug}/image/${logoKey}`), CTX);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  test('foreign/unowned but well-formed key → 404 (leak guard)', async () => {
    const foreign = `brand/${clientId}/logo_alt`; // valid shape, not stored/owned
    expect((await pubBrandImageHandler(get(`/api/public/brand/${slug}/image/${foreign}`), CTX)).status).toBe(404);
  });

  test('unknown-prefix key → 404', async () => {
    expect((await pubBrandImageHandler(get(`/api/public/brand/${slug}/image/product-images/x/y`), CTX)).status).toBe(404);
  });

  test('unknown slug → 404', async () => {
    expect((await pubBrandImageHandler(get(`/api/public/brand/nope-xyz/image/${logoKey}`), CTX)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/pub-brand-image.test.ts` → FAIL.

- [ ] **Step 3: Implement the endpoint**

Create `netlify/functions/pub-brand-image.ts`:

```ts
// GET /api/public/brand/:slug/image/:key — public, ownership-validated brand
// image stream. The key path segment carries slashes (brand/<clientId>/<kind>);
// everything after "/image/" is the key. See branding spec §5.5.
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveClientBySlug, brandStore, isAllowedBrandKey, sniffImageMime } from './_shared/brand';
import { clientIp, checkLimit } from './_pub-ratelimit';

export const config = { path: '/api/public/brand/:slug/image/*', method: 'GET' };

function parts(req: Request): { slug: string; key: string } {
  const path = new URL(req.url).pathname;
  const marker = '/image/';
  const segs = path.split('/').filter(Boolean); // api, public, brand, <slug>, image, brand, <clientId>, <kind>
  const slug = decodeURIComponent(segs[3] ?? '');
  const i = path.indexOf(marker);
  const key = i >= 0 ? decodeURIComponent(path.slice(i + marker.length)) : '';
  return { slug, key };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const rl = await checkLimit(clientIp(req), 'brand-image', { perMinute: 60 });
  if (!rl.ok) return jsonError(429, rl.code ?? 'rate_limited');

  const { slug, key } = parts(req);
  const tenant = await resolveClientBySlug(slug);
  if (!tenant) return jsonError(404, 'not_found');

  // Structural guard first (no blob enumeration on malformed keys).
  if (!isAllowedBrandKey(key)) return jsonError(404, 'not_found');
  if (!key.startsWith('brand/')) return jsonError(404, 'not_found'); // known-prefix, defense-in-depth

  const sql = db();
  const owner = (await sql`
    SELECT 1 FROM public.clients WHERE id = ${tenant.clientId}::uuid
      AND (brand_logo_key = ${key} OR brand_logo_alt_key = ${key} OR brand_favicon_key = ${key}
           OR brand_app_icon_key = ${key} OR brand_social_key = ${key}
           OR ${key} = ANY(brand_hero_keys))
    LIMIT 1
  `) as unknown[];
  if (owner.length === 0) return jsonError(404, 'not_found');

  const bytes = (await brandStore().get(key, { type: 'arrayBuffer' })) as ArrayBuffer | null;
  if (!bytes) return jsonError(404, 'not_found');

  const mime = sniffImageMime(bytes) ?? 'application/octet-stream';
  return new Response(bytes, { status: 200, headers: { 'content-type': mime, 'cache-control': 'public, max-age=86400' } });
}
```

**Note on `config.path`:** the key contains slashes, so the route uses a splat (`/image/*`). Verify Netlify's splat routing works for this shape during smoke (Task 16); if the platform requires a different splat syntax, adjust `config.path` — but the handler parses the raw pathname regardless, so tests pass independent of the route declaration.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/integration/pub-brand-image.test.ts` → pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add netlify/functions/pub-brand-image.ts tests/integration/pub-brand-image.test.ts
git commit -m "feat(branding): GET /api/public/brand/:slug/image/:key

Ownership-validated image stream: structural key guard + known-prefix
routing + DB ownership check (5 stable keys OR = ANY(hero_keys)) →
404 on any miss (leak guard). 24h cache; sniffed content-type.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `src/modules/branding/branding.ts` — color helpers + font allowlist

**Files:**
- Create: `src/modules/branding/branding.ts`
- Test: `tests/unit/branding-lib.test.ts`

**Interfaces:**
- Produces: `isHexColor(s): boolean`; `onAccent(hex): '#161616'|'#ffffff'`; `dominantColorFromPixels(data: Uint8ClampedArray): string|null`; `suggestAccentFromLogo(file, sampleSize?): Promise<string|null>`; `BRAND_FONT_ALLOWLIST` (readonly array of `{ family, category, pkg, variable }`); `isAllowlistedFont(family): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/branding-lib.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { isHexColor, onAccent, dominantColorFromPixels, isAllowlistedFont, BRAND_FONT_ALLOWLIST } from '../../src/modules/branding/branding';

describe('isHexColor', () => {
  test('accepts #rrggbb', () => { expect(isHexColor('#3b82f6')).toBe(true); expect(isHexColor('#FFFFFF')).toBe(true); });
  test('rejects malformed', () => { expect(isHexColor('#fff')).toBe(false); expect(isHexColor('3b82f6')).toBe(false); expect(isHexColor('#zzzzzz')).toBe(false); });
});

describe('onAccent', () => {
  test('dark accent → white text', () => { expect(onAccent('#161616')).toBe('#ffffff'); expect(onAccent('#3b82f6')).toBe('#ffffff'); });
  test('light accent → black text', () => { expect(onAccent('#ffffff')).toBe('#161616'); expect(onAccent('#fde047')).toBe('#161616'); });
});

describe('dominantColorFromPixels', () => {
  test('solid saturated red → a red-ish hex', () => {
    const px = new Uint8ClampedArray(4 * 100);
    for (let i = 0; i < px.length; i += 4) { px[i] = 220; px[i+1] = 20; px[i+2] = 20; px[i+3] = 255; }
    const hex = dominantColorFromPixels(px);
    expect(hex).not.toBeNull();
    expect(hex!.startsWith('#')).toBe(true);
  });
  test('near-white only → null', () => {
    const px = new Uint8ClampedArray(4 * 100);
    for (let i = 0; i < px.length; i += 4) { px[i] = 250; px[i+1] = 250; px[i+2] = 250; px[i+3] = 255; }
    expect(dominantColorFromPixels(px)).toBeNull();
  });
});

describe('font allowlist', () => {
  test('isAllowlistedFont matches a known family and rejects unknown / null', () => {
    expect(isAllowlistedFont('Inter')).toBe(true);
    expect(isAllowlistedFont('Comic Sans MS')).toBe(false);
    expect(isAllowlistedFont(null)).toBe(false);
    expect(isAllowlistedFont(undefined)).toBe(false);
  });
  test('every allowlist entry has family + pkg + category', () => {
    for (const f of BRAND_FONT_ALLOWLIST) {
      expect(typeof f.family).toBe('string');
      expect(f.pkg.startsWith('@fontsource')).toBe(true);
      expect(['sans','serif','display','mono']).toContain(f.category);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/branding-lib.test.ts` → FAIL.

- [ ] **Step 3: Implement `branding.ts`**

Create `src/modules/branding/branding.ts` (port the color helpers verbatim from POS v3's `src/modules/pos/lib/branding.ts`, then add the allowlist):

```ts
export function isHexColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

function toRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// WCAG relative luminance → legible text color painted on the accent.
export function onAccent(hex: string): '#161616' | '#ffffff' {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? '#161616' : '#ffffff';
}

function hex2(n: number): string { return n.toString(16).padStart(2, '0'); }

// Dominant-vibrant picker: quantize, score by saturation, ignore near-white/
// black/low-saturation pixels.
export function dominantColorFromPixels(data: Uint8ClampedArray): string | null {
  const buckets = new Map<string, { r: number; g: number; b: number; score: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (max > 240 && min > 240) continue;
    if (max < 24) continue;
    if (sat < 0.2) continue;
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const cur = buckets.get(key) ?? { r, g, b, score: 0 };
    cur.score += sat;
    buckets.set(key, cur);
  }
  let best: { r: number; g: number; b: number; score: number } | null = null;
  for (const v of buckets.values()) if (!best || v.score > best.score) best = v;
  return best ? `#${hex2(best.r)}${hex2(best.g)}${hex2(best.b)}` : null;
}

// Suggest an accent from an uploaded logo, client-side. Must run on the local
// File (not a stored URL) to avoid CORS/tainted-canvas. Resolves null on failure.
export async function suggestAccentFromLogo(file: File, sampleSize = 48): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const w = Math.max(1, Math.min(sampleSize, bitmap.width));
    const h = Math.max(1, Math.min(sampleSize, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return dominantColorFromPixels(ctx.getImageData(0, 0, w, h).data);
  } catch {
    return null;
  }
}

// Curated self-hosted font allowlist. `family` is the exact CSS font-family
// registered by the corresponding @fontsource package (see brand-fonts.ts).
export const BRAND_FONT_ALLOWLIST: readonly {
  family: string;
  category: 'sans' | 'serif' | 'display' | 'mono';
  pkg: string;
  variable: boolean;
}[] = [
  { family: 'Inter',            category: 'sans',    pkg: '@fontsource-variable/inter',            variable: true },
  { family: 'Roboto',           category: 'sans',    pkg: '@fontsource-variable/roboto',           variable: true },
  { family: 'Open Sans',        category: 'sans',    pkg: '@fontsource-variable/open-sans',        variable: true },
  { family: 'Montserrat',       category: 'sans',    pkg: '@fontsource-variable/montserrat',       variable: true },
  { family: 'Poppins',          category: 'sans',    pkg: '@fontsource/poppins',                   variable: false },
  { family: 'Work Sans',        category: 'sans',    pkg: '@fontsource-variable/work-sans',        variable: true },
  { family: 'Merriweather',     category: 'serif',   pkg: '@fontsource-variable/merriweather',     variable: true },
  { family: 'Playfair Display', category: 'serif',   pkg: '@fontsource-variable/playfair-display', variable: true },
  { family: 'Lora',             category: 'serif',   pkg: '@fontsource-variable/lora',             variable: true },
  { family: 'PT Serif',         category: 'serif',   pkg: '@fontsource/pt-serif',                  variable: false },
  { family: 'Bebas Neue',       category: 'display', pkg: '@fontsource/bebas-neue',                variable: false },
  { family: 'Anton',            category: 'display', pkg: '@fontsource/anton',                     variable: false },
  { family: 'JetBrains Mono',   category: 'mono',    pkg: '@fontsource-variable/jetbrains-mono',   variable: true },
  { family: 'Space Mono',       category: 'mono',    pkg: '@fontsource/space-mono',                variable: false },
] as const;

export function isAllowlistedFont(family: string | null | undefined): boolean {
  if (!family) return false;
  return BRAND_FONT_ALLOWLIST.some((f) => f.family === family);
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/branding-lib.test.ts` → pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add src/modules/branding/branding.ts tests/unit/branding-lib.test.ts
git commit -m "feat(branding): branding.ts — color helpers + font allowlist

Port onAccent/isHexColor/dominantColorFromPixels/suggestAccentFromLogo
from POS v3; add the 14-family self-hosted font allowlist + isAllowlistedFont.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `types.ts` + `downscale.ts`

**Files:**
- Create: `src/modules/branding/types.ts`
- Create: `src/modules/branding/downscale.ts`
- Test: `tests/unit/branding-downscale.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `export interface Brand { name: string; logoUrl: string|null; logoAltUrl: string|null; faviconUrl: string|null; appIconUrl: string|null; socialUrl: string|null; heroUrls: string[]; accent: string|null; theme: 'dark'|'light'; fontHeading: string|null; fontBody: string|null }`. Also `export type DownscaleKind = 'logo'|'logo_alt'|'favicon'|'app_icon'|'social'|'hero'`.
  - `downscale.ts`: `MAX_EDGE: Record<DownscaleKind, number>`; `downscaleImage(file: File, kind: DownscaleKind): Promise<File>`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/branding-downscale.test.ts` (node env — `createImageBitmap` is absent, so we assert the graceful-fallback path + the caps):

```ts
import { describe, expect, test } from 'vitest';
import { downscaleImage, MAX_EDGE } from '../../src/modules/branding/downscale';

describe('MAX_EDGE caps', () => {
  test('per-kind longest-edge caps are the intended values', () => {
    expect(MAX_EDGE.favicon).toBe(64);
    expect(MAX_EDGE.app_icon).toBe(512);
    expect(MAX_EDGE.logo).toBe(400);
    expect(MAX_EDGE.logo_alt).toBe(400);
    expect(MAX_EDGE.social).toBe(1200);
    expect(MAX_EDGE.hero).toBe(1600);
  });
});

describe('downscaleImage graceful fallback', () => {
  test('returns the original file when canvas/createImageBitmap is unavailable (node env)', async () => {
    const original = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
    const out = await downscaleImage(original, 'logo');
    // In node there is no createImageBitmap → catch → original returned unchanged.
    expect(out).toBe(original);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/branding-downscale.test.ts` → FAIL.

- [ ] **Step 3: Implement `types.ts` then `downscale.ts`**

Create `src/modules/branding/types.ts`:

```ts
// Shared branding types. `Brand` is the public payload contract consumed by
// POS, Booking, and any customer-facing surface (see spec §9.1).
export interface Brand {
  name: string;
  logoUrl:     string | null;
  logoAltUrl:  string | null;
  faviconUrl:  string | null;
  appIconUrl:  string | null;
  socialUrl:   string | null;
  heroUrls:    string[];
  accent:      string | null;
  theme:       'dark' | 'light';
  fontHeading: string | null;
  fontBody:    string | null;
}

export type DownscaleKind = 'logo' | 'logo_alt' | 'favicon' | 'app_icon' | 'social' | 'hero';
```

Create `src/modules/branding/downscale.ts`:

```ts
import type { DownscaleKind } from './types';

// Longest-edge cap per kind (px). Aspect preserved; no upscaling.
export const MAX_EDGE: Record<DownscaleKind, number> = {
  favicon: 64, app_icon: 512, logo: 400, logo_alt: 400, social: 1200, hero: 1600,
};

/**
 * Downscale `file` to the per-kind longest-edge cap and re-encode as WebP.
 * On any decode/encode failure (or in a non-browser env), returns the original
 * file unchanged — the server-side 5 MB cap + magic-byte sniff remain the
 * authoritative guard.
 */
export async function downscaleImage(file: File, kind: DownscaleKind): Promise<File> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
    const bitmap = await createImageBitmap(file);
    const cap = MAX_EDGE[kind];
    const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/branding-downscale.test.ts` → pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add src/modules/branding/types.ts src/modules/branding/downscale.ts tests/unit/branding-downscale.test.ts
git commit -m "feat(branding): Brand type + client-side downscaleImage

Brand payload contract (spec §9.1). downscaleImage caps each kind's
longest edge (favicon 64 … hero 1600), re-encodes WebP, and falls back
to the original on any failure (server cap stays authoritative).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `brand-fonts.ts` — self-hosted `@fontsource` imports + deps + app-root wiring

**Files:**
- Create: `src/modules/branding/brand-fonts.ts`
- Modify: `src/main.tsx` (add one import line)
- Modify: `package.json` (add `@fontsource*` deps — via `npm install`)

**Interfaces:**
- Consumes: the 14 packages named in `BRAND_FONT_ALLOWLIST[].pkg` (Task 7).
- Produces: side-effect module registering `@font-face` for all allowlisted families; imported once at app root.

- [ ] **Step 1: Install the font packages**

Run (from the worktree root):
```bash
npm install \
  @fontsource-variable/inter @fontsource-variable/roboto @fontsource-variable/open-sans \
  @fontsource-variable/montserrat @fontsource/poppins @fontsource-variable/work-sans \
  @fontsource-variable/merriweather @fontsource-variable/playfair-display \
  @fontsource-variable/lora @fontsource/pt-serif @fontsource/bebas-neue \
  @fontsource/anton @fontsource-variable/jetbrains-mono @fontsource/space-mono
```
If any package name 404s on npm, find the correct one (`npm view @fontsource-variable/<name>`) and update BOTH the install command AND `BRAND_FONT_ALLOWLIST` in `branding.ts` to match. Some families exist only as non-variable (`@fontsource/<name>`) — set `variable: false` and import specific weights.

- [ ] **Step 2: Create `brand-fonts.ts`**

Create `src/modules/branding/brand-fonts.ts`:

```ts
// Self-hosted brand fonts. Imported once at app root (src/main.tsx). Each
// import registers @font-face for one allowlisted family; WOFF2 sources are
// lazy, so declaring all 14 costs ~0 until a family is actually rendered.
// Keep this list in sync with BRAND_FONT_ALLOWLIST in branding.ts.
import '@fontsource-variable/inter';
import '@fontsource-variable/roboto';
import '@fontsource-variable/open-sans';
import '@fontsource-variable/montserrat';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource-variable/work-sans';
import '@fontsource-variable/merriweather';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/lora';
import '@fontsource/pt-serif/400.css';
import '@fontsource/pt-serif/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/anton/400.css';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
```

Adjust the exact import subpaths to match each installed package's actual entry points (variable packages typically expose the bare package import; non-variable expose `/<weight>.css`). Verify against `node_modules/@fontsource*/` after install.

- [ ] **Step 3: Wire into app root**

In `src/main.tsx`, add after the existing CSS imports (lines 1-4 are `theme.css`, `components.css`, `pos.css`, `files.css`):

```ts
import './modules/branding/brand-fonts';
```

- [ ] **Step 4: Verify build + typecheck**

Run: `npm run typecheck` → clean.
Run: `npm run build` → succeeds; confirm font assets are emitted (look for `.woff2` under `dist/assets/`). If the build fails on a font import path, fix the subpath.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add package.json package-lock.json src/modules/branding/brand-fonts.ts src/main.tsx
git commit -m "feat(branding): self-host the 14 allowlist fonts via @fontsource

brand-fonts.ts imports all allowlisted families (lazy @font-face);
wired once at app root. No third-party CDN — GDPR-clean, no CSP change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `useBrand.ts` hook

**Files:**
- Create: `src/modules/branding/useBrand.ts`
- Test: `tests/unit/branding-useBrand.test.tsx`

**Interfaces:**
- Consumes: `Brand` from `./types`.
- Produces: `useBrand(slug: string|null|undefined): { brand: Brand|null; loading: boolean; error: string|null }`. Fetches `/api/public/brand/:slug`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/branding-useBrand.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBrand } from '../../src/modules/branding/useBrand';

const SAMPLE = { name: 'Acme', logoUrl: null, logoAltUrl: null, faviconUrl: null, appIconUrl: null, socialUrl: null, heroUrls: [], accent: '#3b82f6', theme: 'light', fontHeading: 'Inter', fontBody: null };

afterEach(() => { vi.restoreAllMocks(); });

describe('useBrand', () => {
  test('success sets brand + clears loading', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(SAMPLE), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    const { result } = renderHook(() => useBrand('acme'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brand?.name).toBe('Acme');
    expect(result.current.error).toBeNull();
  });

  test('HTTP error sets error, null brand', async () => {
    global.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as never;
    const { result } = renderHook(() => useBrand('missing'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brand).toBeNull();
    expect(result.current.error).not.toBeNull();
  });

  test('null slug → idle, no fetch', async () => {
    const f = vi.fn();
    global.fetch = f as never;
    const { result } = renderHook(() => useBrand(null));
    expect(result.current.loading).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/branding-useBrand.test.tsx` → FAIL.

- [ ] **Step 3: Implement `useBrand.ts`**

Create `src/modules/branding/useBrand.ts`:

```ts
import { useEffect, useState } from 'react';
import type { Brand } from './types';

export function useBrand(slug: string | null | undefined): {
  brand: Brand | null;
  loading: boolean;
  error: string | null;
} {
  const [state, setState] = useState<{ brand: Brand | null; loading: boolean; error: string | null }>({
    brand: null, loading: !!slug, error: null,
  });
  useEffect(() => {
    if (!slug) { setState({ brand: null, loading: false, error: null }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(`/api/public/brand/${encodeURIComponent(slug)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((brand: Brand) => { if (!cancelled) setState({ brand, loading: false, error: null }); })
      .catch((e: Error) => { if (!cancelled) setState({ brand: null, loading: false, error: e.message }); });
    return () => { cancelled = true; };
  }, [slug]);
  return state;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/branding-useBrand.test.tsx` → pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add src/modules/branding/useBrand.ts tests/unit/branding-useBrand.test.tsx
git commit -m "feat(branding): useBrand hook — fetches /api/public/brand/:slug

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `BrandShell.tsx`

**Files:**
- Create: `src/modules/branding/BrandShell.tsx`
- Test: `tests/unit/branding-BrandShell.test.tsx`

**Interfaces:**
- Consumes: `onAccent` (Task 7); `Brand` (Task 8).
- Produces: `export function BrandShell({ brand?, fallbackName?, children }: { brand?: Brand; fallbackName?: string; children: ReactNode })`. Sets `data-theme`, inline `--accent`/`--accent-hover`/`--text-on-accent`/`--brand-font-heading`/`--brand-font-body`, injects favicon + apple-touch-icon `<link>` (NOT fonts), renders logo-or-name header.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/branding-BrandShell.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, expect, test, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { BrandShell } from '../../src/modules/branding/BrandShell';
import type { Brand } from '../../src/modules/branding/types';

const base: Brand = { name: 'Acme', logoUrl: null, logoAltUrl: null, faviconUrl: null, appIconUrl: null, socialUrl: null, heroUrls: [], accent: null, theme: 'dark', fontHeading: null, fontBody: null };

afterEach(() => {
  cleanup();
  document.querySelectorAll('link[data-brand-shell="1"]').forEach((el) => el.remove());
});

describe('BrandShell', () => {
  test('sets data-theme from brand', () => {
    const { container } = render(<BrandShell brand={{ ...base, theme: 'light' }}>x</BrandShell>);
    expect(container.querySelector('.brand-shell')?.getAttribute('data-theme')).toBe('light');
  });

  test('applies inline accent custom props when accent set', () => {
    const { container } = render(<BrandShell brand={{ ...base, accent: '#3b82f6' }}>x</BrandShell>);
    const el = container.querySelector('.brand-shell') as HTMLElement;
    expect(el.style.getPropertyValue('--accent')).toBe('#3b82f6');
    expect(el.style.getPropertyValue('--text-on-accent')).toBe('#ffffff');
  });

  test('applies inline font custom props when families set', () => {
    const { container } = render(<BrandShell brand={{ ...base, fontHeading: 'Inter', fontBody: 'Lora' }}>x</BrandShell>);
    const el = container.querySelector('.brand-shell') as HTMLElement;
    expect(el.style.getPropertyValue('--brand-font-heading')).toContain('Inter');
    expect(el.style.getPropertyValue('--brand-font-body')).toContain('Lora');
  });

  test('renders logo img when logoUrl set, else the name', () => {
    const { container, rerender } = render(<BrandShell brand={base}>x</BrandShell>);
    expect(container.querySelector('.brand-logo')).toBeNull();
    expect(container.textContent).toContain('Acme');
    rerender(<BrandShell brand={{ ...base, logoUrl: '/img/logo' }}>x</BrandShell>);
    expect(container.querySelector('img.brand-logo')?.getAttribute('src')).toBe('/img/logo');
  });

  test('injects favicon + apple-touch-icon links (not fonts) on mount', async () => {
    render(<BrandShell brand={{ ...base, faviconUrl: '/img/fav', appIconUrl: '/img/app' }}>x</BrandShell>);
    // effects run async; flush a microtask
    await Promise.resolve();
    expect(document.querySelector('link[rel="icon"][data-brand-shell="1"]')?.getAttribute('href')).toBe('/img/fav');
    expect(document.querySelector('link[rel="apple-touch-icon"][data-brand-shell="1"]')?.getAttribute('href')).toBe('/img/app');
    expect(document.querySelector('link[rel="stylesheet"][data-brand-shell="1"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/branding-BrandShell.test.tsx` → FAIL.

- [ ] **Step 3: Implement `BrandShell.tsx`**

Create `src/modules/branding/BrandShell.tsx` (exactly the spec §6.2 code):

```tsx
import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { onAccent } from './branding';
import type { Brand } from './types';

interface Props {
  brand?: Brand;
  fallbackName?: string;
  children: ReactNode;
}

export function BrandShell({ brand, fallbackName, children }: Props) {
  const theme = brand?.theme ?? 'dark';
  const accent = brand?.accent ?? null;
  const style: CSSProperties & Record<string, string> = {};
  if (accent) {
    style['--accent'] = accent;
    style['--accent-hover'] = accent;
    style['--text-on-accent'] = onAccent(accent);
  }
  if (brand?.fontHeading) style['--brand-font-heading'] = `"${brand.fontHeading}", var(--font-sans)`;
  if (brand?.fontBody)    style['--brand-font-body']    = `"${brand.fontBody}", var(--font-sans)`;

  // Head-injection: favicon + apple-touch-icon only. Fonts are self-hosted
  // @font-face resolved via the --brand-font-* custom props; no runtime <link>.
  useEffect(() => {
    const created: HTMLElement[] = [];
    const upsert = (rel: string, href: string) => {
      const existing = document.querySelector(`link[rel="${rel}"][data-brand-shell="1"]`);
      if (existing) existing.setAttribute('href', href);
      else {
        const el = document.createElement('link');
        el.rel = rel; el.href = href; el.dataset.brandShell = '1';
        document.head.appendChild(el);
        created.push(el);
      }
    };
    if (brand?.faviconUrl) upsert('icon', brand.faviconUrl);
    if (brand?.appIconUrl) upsert('apple-touch-icon', brand.appIconUrl);
    return () => { created.forEach((el) => el.remove()); };
  }, [brand?.faviconUrl, brand?.appIconUrl]);

  return (
    <div className="brand-shell" data-theme={theme} style={style}>
      <header className="brand-header">
        {brand?.logoUrl
          ? <img className="brand-logo" src={brand.logoUrl} alt={brand.name || fallbackName || 'Brand'} />
          : <span className="brand-tenant">{brand?.name || fallbackName || 'Workspace'}</span>}
      </header>
      <main className="brand-main">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/branding-BrandShell.test.tsx` → pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add src/modules/branding/BrandShell.tsx tests/unit/branding-BrandShell.test.tsx
git commit -m "feat(branding): BrandShell — theme/accent/font props + icon injection

Applies data-theme + inline --accent/--text-on-accent/--brand-font-*;
injects favicon + apple-touch-icon (fonts are self-hosted @font-face, no
runtime <link>); logo-or-name header. Cleans up injected links on unmount.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `BrandHero.tsx` — carousel

**Files:**
- Create: `src/modules/branding/BrandHero.tsx`
- Test: `tests/unit/branding-BrandHero.test.tsx`

**Interfaces:**
- Produces: `export function BrandHero({ heroUrls, interval? }: { heroUrls: string[]; interval?: number })`. Single slide static; multi-slide auto-rotates (default 5000ms); dots + prev/next chevrons; `ArrowLeft`/`ArrowRight` keys; pauses under `prefers-reduced-motion`; renders nothing for empty array.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/branding-BrandHero.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { BrandHero } from '../../src/modules/branding/BrandHero';

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom lacks matchMedia; default to "no reduce".
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } } as unknown as MediaQueryList));
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('BrandHero', () => {
  test('renders nothing for empty', () => {
    const { container } = render(<BrandHero heroUrls={[]} />);
    expect(container.firstChild).toBeNull();
  });

  test('single slide: image but no chevrons/dots', () => {
    const { container } = render(<BrandHero heroUrls={['/a']} />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('.brand-hero-dot')).toBeNull();
  });

  test('multi-slide auto-rotates on the interval', () => {
    const { container } = render(<BrandHero heroUrls={['/a', '/b']} interval={5000} />);
    const imgSrc = () => container.querySelector('img')?.getAttribute('src');
    expect(imgSrc()).toBe('/a');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(imgSrc()).toBe('/b');
  });

  test('next chevron advances', () => {
    const { container, getByLabelText } = render(<BrandHero heroUrls={['/a', '/b']} />);
    fireEvent.click(getByLabelText(/next/i));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/branding-BrandHero.test.tsx` → FAIL.

- [ ] **Step 3: Implement `BrandHero.tsx`**

Create `src/modules/branding/BrandHero.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

export function BrandHero({ heroUrls, interval = 5000 }: { heroUrls: string[]; interval?: number }) {
  const [idx, setIdx] = useState(0);
  const reduce = usePrefersReducedMotion();
  const n = heroUrls.length;

  const go = useCallback((next: number) => setIdx((i) => ((next % n) + n) % n), [n]);

  useEffect(() => {
    if (reduce || n < 2) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % n), interval);
    return () => clearInterval(id);
  }, [reduce, n, interval]);

  useEffect(() => {
    if (n < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(idx - 1);
      else if (e.key === 'ArrowRight') go(idx + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, n, go]);

  if (n === 0) return null;
  const current = heroUrls[Math.min(idx, n - 1)]!;

  return (
    <div className="brand-hero-carousel">
      <img className="brand-hero" src={current} alt="" />
      {n > 1 && (
        <>
          <button type="button" className="brand-hero-nav brand-hero-prev" aria-label="Previous slide" onClick={() => go(idx - 1)}>‹</button>
          <button type="button" className="brand-hero-nav brand-hero-next" aria-label="Next slide" onClick={() => go(idx + 1)}>›</button>
          <div className="brand-hero-dots">
            {heroUrls.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`brand-hero-dot${i === idx ? ' is-active' : ''}`}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === idx}
                onClick={() => go(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/branding-BrandHero.test.tsx` → pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add src/modules/branding/BrandHero.tsx tests/unit/branding-BrandHero.test.tsx
git commit -m "feat(branding): BrandHero — auto-rotating carousel

5s auto-advance, dots + chevrons, arrow-key nav, prefers-reduced-motion
pause, single-slide static, empty → null.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: CSS (light theme + brand styles) + `index.ts` barrel

**Files:**
- Modify: `src/lib/components.css` (append a branding block)
- Create: `src/modules/branding/index.ts`
- Test: none (visual/typecheck; covered by build)

**Interfaces:**
- Produces: `src/modules/branding/index.ts` re-exporting `BrandShell`, `BrandHero`, `useBrand`, `Brand` type, and the helper functions — the public surface POS/Booking import (spec §9.3).

- [ ] **Step 1: Create the barrel**

Create `src/modules/branding/index.ts`:

```ts
export { BrandShell } from './BrandShell';
export { BrandHero } from './BrandHero';
export { useBrand } from './useBrand';
export { onAccent, isHexColor, isAllowlistedFont, suggestAccentFromLogo, BRAND_FONT_ALLOWLIST } from './branding';
export { downscaleImage, MAX_EDGE } from './downscale';
export type { Brand, DownscaleKind } from './types';
```

- [ ] **Step 2: Append CSS to `src/lib/components.css`**

Append this block to `src/lib/components.css`:

```css
/* ── Platform branding ──────────────────────────────────────────────── */
/* Light-theme token overrides, scoped so the default dark app is untouched. */
.brand-shell[data-theme="light"] {
  --bg-base:        #faf8f3;
  --bg-surface:     #ffffff;
  --bg-elevated:    #f2eee6;
  --border-subtle:  #e7e2d8;
  --border-default: #d8d2c6;
  --border-strong:  #c3bcae;
  --text-primary:   #1f1c17;
  --text-secondary: #55504700;
  --text-secondary: #555047;
  --text-muted:     #8a8478;
}

.brand-shell {
  min-height: 100%;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--brand-font-body, var(--font-sans));
}
.brand-shell h1, .brand-shell h2, .brand-shell h3 {
  font-family: var(--brand-font-heading, var(--font-sans));
}
.brand-header { display: flex; align-items: center; justify-content: center; padding: 16px; }
.brand-logo { max-height: 40px; object-fit: contain; }
.brand-tenant { font-size: 18px; font-weight: 600; }
.brand-main { padding: 16px; }

/* Hero carousel */
.brand-hero-carousel { position: relative; }
.brand-hero { width: 100%; max-height: 360px; object-fit: cover; border-radius: var(--radius-md, 8px); display: block; }
.brand-hero-nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  background: rgba(0,0,0,0.4); color: #fff; border: none; border-radius: 999px;
  width: 36px; height: 36px; font-size: 22px; cursor: pointer;
}
.brand-hero-prev { left: 8px; }
.brand-hero-next { right: 8px; }
.brand-hero-dots { position: absolute; bottom: 10px; left: 0; right: 0; display: flex; gap: 6px; justify-content: center; }
.brand-hero-dot { width: 8px; height: 8px; border-radius: 999px; border: none; background: rgba(255,255,255,0.5); cursor: pointer; padding: 0; }
.brand-hero-dot.is-active { background: #fff; }

/* Branding settings card (mirrors .ams-export-card conventions) */
.brand-card {
  border: 1px solid var(--border-default, #3a3a3a);
  border-radius: var(--radius-md, 8px);
  padding: 16px 20px;
  margin-top: 24px;
  background: var(--bg-surface, #1f1f1f);
  color: var(--text-primary, #ece8df);
}
.brand-card h3 { margin: 0 0 8px 0; font-size: 16px; color: var(--text-primary, #ece8df); }
.brand-card p  { margin: 0 0 12px 0; color: var(--text-secondary, #a8a39a); }
.brand-card-section { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-subtle, #2e2e2e); }
.brand-card-section:first-of-type { margin-top: 0; padding-top: 0; border-top: none; }
.brand-card-error { color: var(--danger, #c97064); margin-top: 8px; }
.brand-upload-slot {
  display: inline-flex; flex-direction: column; align-items: center; gap: 6px;
  border: 1px dashed var(--border-default, #3a3a3a); border-radius: var(--radius-sm, 4px);
  padding: 10px; min-width: 96px;
}
.brand-upload-slot img { max-width: 72px; max-height: 72px; object-fit: contain; }
.brand-swatch { width: 28px; height: 28px; border-radius: var(--radius-sm, 4px); border: 1px solid var(--border-default, #3a3a3a); display: inline-block; vertical-align: middle; }
```

Note: the duplicate `--text-secondary` line above is a typo guard — use the single correct declaration `--text-secondary: #555047;` and delete the `#55504700` line. (Left visible so the implementer removes it.)

- [ ] **Step 3: Verify build + typecheck**

Run: `npm run typecheck` → clean.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add src/lib/components.css src/modules/branding/index.ts
git commit -m "feat(branding): light-theme tokens + brand/hero/card CSS + barrel

Light-theme overrides scoped to .brand-shell[data-theme=light]; hero
carousel + logo + settings-card styles; index.ts public barrel for
POS/Booking consumption.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: `BrandingForm.tsx` — shared settings form

**Files:**
- Create: `src/modules/branding/BrandingForm.tsx`
- Test: `tests/unit/branding-BrandingForm.test.tsx`

**Interfaces:**
- Consumes: `downscaleImage`, `Brand`, `BRAND_FONT_ALLOWLIST`, `isHexColor`, `suggestAccentFromLogo` (all from the branding module).
- Produces: `export interface BrandingApi { uploadImage(kind: DownscaleKind, file: File): Promise<{ key: string }>; patch(body: Record<string, unknown>): Promise<void>; }` and `export function BrandingForm({ brand, api, onSaved }: { brand: Brand | null; api: BrandingApi; onSaved?: () => void }): JSX.Element`. Four sections: Logos (5 slots), Hero carousel, Colors (accent + theme), Typography (heading/body pickers). Each uploaded file passes through `downscaleImage(file, kind)` before `api.uploadImage`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/branding-BrandingForm.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { BrandingForm, type BrandingApi } from '../../src/modules/branding/BrandingForm';
import type { Brand } from '../../src/modules/branding/types';

const base: Brand = { name: 'Acme', logoUrl: null, logoAltUrl: null, faviconUrl: null, appIconUrl: null, socialUrl: null, heroUrls: [], accent: null, theme: 'dark', fontHeading: null, fontBody: null };
afterEach(() => cleanup());

function mkApi(): BrandingApi {
  return {
    uploadImage: vi.fn(async () => ({ key: 'brand/x/logo' })),
    patch: vi.fn(async () => {}),
  };
}

describe('BrandingForm', () => {
  test('renders the four sections', () => {
    render(<BrandingForm brand={base} api={mkApi()} />);
    expect(screen.getByText(/logos/i)).toBeTruthy();
    expect(screen.getByText(/hero/i)).toBeTruthy();
    expect(screen.getByText(/colou?r|accent|theme/i)).toBeTruthy();
    expect(screen.getByText(/typograph|font/i)).toBeTruthy();
  });

  test('theme toggle patches brand_theme', async () => {
    const api = mkApi();
    render(<BrandingForm brand={base} api={api} />);
    fireEvent.click(screen.getByLabelText(/light/i));
    // Some designs auto-save on toggle; others need a Save. Assert patch called with theme.
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const call = (api.patch as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(call.theme).toBe('light');
  });

  test('accent picker rejects a bad hex (no patch) and accepts a good one', async () => {
    const api = mkApi();
    render(<BrandingForm brand={base} api={api} />);
    const hexInput = screen.getByLabelText(/accent/i) as HTMLInputElement;
    fireEvent.change(hexInput, { target: { value: 'nothex' } });
    fireEvent.blur(hexInput);
    expect((api.patch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
    fireEvent.change(hexInput, { target: { value: '#3b82f6' } });
    fireEvent.blur(hexInput);
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
  });

  test('font picker lists allowlist families', () => {
    render(<BrandingForm brand={base} api={mkApi()} />);
    const headingSelect = screen.getByLabelText(/heading font/i) as HTMLSelectElement;
    const options = Array.from(headingSelect.options).map((o) => o.value);
    expect(options).toContain('Inter');
    expect(options).toContain('Merriweather');
  });
});
```

The exact ARIA labels/text are the implementer's to choose, but they MUST make these queries resolvable (a "Light" theme control, an "Accent" input, a "Heading font" select, and section headings containing "Logos"/"Hero"/"font"). If a design auto-saves vs. explicit-save changes the flow, keep the observable contract: changing a valid control results in an `api.patch` call carrying that field; an invalid accent does not patch.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/branding-BrandingForm.test.tsx` → FAIL.

- [ ] **Step 3: Implement `BrandingForm.tsx`**

Build the component with four sections. Key requirements (implementer composes the JSX; the shape below is the contract):

```tsx
import { useState } from 'react';
import type { Brand, DownscaleKind } from './types';
import { downscaleImage } from './downscale';
import { BRAND_FONT_ALLOWLIST, isHexColor, suggestAccentFromLogo } from './branding';

export interface BrandingApi {
  uploadImage(kind: DownscaleKind, file: File): Promise<{ key: string }>;
  patch(body: Record<string, unknown>): Promise<void>;
}

const LOGO_KINDS: { kind: DownscaleKind; label: string; field: string }[] = [
  { kind: 'logo',     label: 'Primary logo',   field: 'logoKey' },
  { kind: 'logo_alt', label: 'Alternate logo', field: 'logoAltKey' },
  { kind: 'favicon',  label: 'Favicon',        field: 'faviconKey' },
  { kind: 'app_icon', label: 'App icon',       field: 'appIconKey' },
  { kind: 'social',   label: 'Social image',   field: 'socialKey' },
];

export function BrandingForm({ brand, api, onSaved }: { brand: Brand | null; api: BrandingApi; onSaved?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [accent, setAccent] = useState(brand?.accent ?? '');

  async function patch(body: Record<string, unknown>) {
    setBusy('patch'); setErr(null);
    try { await api.patch(body); onSaved?.(); }
    catch { setErr('Save failed. Try again.'); }
    finally { setBusy(null); }
  }

  async function onPickImage(kind: DownscaleKind, field: string, file: File) {
    setBusy(kind); setErr(null);
    try {
      const scaled = await downscaleImage(file, kind);
      const { key } = await api.uploadImage(kind, scaled);
      await api.patch({ [field]: key });
      // Seed the accent from the primary logo if none set yet.
      if (kind === 'logo' && !accent) {
        const suggested = await suggestAccentFromLogo(file);
        if (suggested) { setAccent(suggested); await api.patch({ accent: suggested }); }
      }
      onSaved?.();
    } catch { setErr('Upload failed. Try again.'); }
    finally { setBusy(null); }
  }

  async function onPickHero(files: FileList) {
    setBusy('hero'); setErr(null);
    try {
      const keys: string[] = [...(brand?.heroUrls ?? [])].length ? [] : []; // start from existing keys is not available here; append newly uploaded
      const newKeys: string[] = [];
      for (const f of Array.from(files)) {
        const scaled = await downscaleImage(f, 'hero');
        const { key } = await api.uploadImage('hero', scaled);
        newKeys.push(key);
      }
      // Note: heroUrls are URLs, not keys. The card wrappers pass current hero
      // KEYS via a dedicated prop if reorder/delete is needed. For v1 append:
      await api.patch({ heroKeys: newKeys });
      onSaved?.();
    } catch { setErr('Hero upload failed.'); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <section className="brand-card-section">
        <h4>Logos</h4>
        {LOGO_KINDS.map(({ kind, label, field }) => (
          <label key={kind} className="brand-upload-slot">
            <span>{label}</span>
            <input type="file" accept="image/*" disabled={busy !== null}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickImage(kind, field, f); }} />
          </label>
        ))}
      </section>

      <section className="brand-card-section">
        <h4>Hero carousel</h4>
        <input type="file" accept="image/*" multiple disabled={busy !== null}
          aria-label="Add hero images"
          onChange={(e) => { const fs = e.target.files; if (fs && fs.length) void onPickHero(fs); }} />
      </section>

      <section className="brand-card-section">
        <h4>Colors &amp; theme</h4>
        <label>
          Accent
          <input aria-label="Accent color" value={accent}
            onChange={(e) => setAccent(e.target.value)}
            onBlur={() => { if (accent === '' || isHexColor(accent)) void patch({ accent: accent === '' ? null : accent }); }} />
        </label>
        <span className="brand-swatch" style={{ background: isHexColor(accent) ? accent : 'transparent' }} />
        <fieldset>
          <legend>Theme</legend>
          <label><input type="radio" name="theme" aria-label="Dark theme" defaultChecked={brand?.theme !== 'light'} onChange={() => void patch({ theme: 'dark' })} /> Dark</label>
          <label><input type="radio" name="theme" aria-label="Light theme" defaultChecked={brand?.theme === 'light'} onChange={() => void patch({ theme: 'light' })} /> Light</label>
        </fieldset>
      </section>

      <section className="brand-card-section">
        <h4>Typography</h4>
        <label>
          Heading font
          <select aria-label="Heading font" defaultValue={brand?.fontHeading ?? ''} onChange={(e) => void patch({ fontHeading: e.target.value || null })}>
            <option value="">Default</option>
            {BRAND_FONT_ALLOWLIST.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
          </select>
        </label>
        <label>
          Body font
          <select aria-label="Body font" defaultValue={brand?.fontBody ?? ''} onChange={(e) => void patch({ fontBody: e.target.value || null })}>
            <option value="">Default</option>
            {BRAND_FONT_ALLOWLIST.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
          </select>
        </label>
      </section>

      {err && <p className="brand-card-error" role="alert">{err}</p>}
    </div>
  );
}
```

Known v1 simplification to document in a code comment: hero reorder/delete is deferred — the form appends newly-uploaded hero keys (the wrappers may pass existing keys through a follow-up prop). The spec's drag-reorder is a v1.1 nicety; the plan ships upload+replace-set. Keep the `onPickHero` honest: replace with the newly uploaded set (document the limitation).

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/branding-BrandingForm.test.tsx` → pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add src/modules/branding/BrandingForm.tsx tests/unit/branding-BrandingForm.test.tsx
git commit -m "feat(branding): BrandingForm — shared 4-section settings form

Logos (5 slots), hero upload, accent+theme, typography pickers. Every
upload passes through downscaleImage first; accent auto-seeds from the
primary logo. Takes a BrandingApi so bucket-user + admin wrappers reuse it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: card wrappers — `WorkspaceBrandingCard` + `AdminWorkspaceBrandingCard`

**Files:**
- Create: `src/modules/branding/WorkspaceBrandingCard.tsx`
- Create: `src/modules/branding/AdminWorkspaceBrandingCard.tsx`
- Test: `tests/unit/branding-cards.test.tsx`

**Interfaces:**
- Consumes: `BrandingForm` + `BrandingApi` (Task 14); `useBrand` (Task 10); `useUserAuth` from `../user-portal/user-auth-context` (for the bucket-user card only).
- Produces:
  - `WorkspaceBrandingCard` (default export) — bucket-user; gates on `permissions['_platform.settings.edit'] || level_number === 1`; builds a self-scoped `BrandingApi` (no `?client=`); fetches current brand via `useBrand(client.slug)`.
  - `AdminWorkspaceBrandingCard` (default export) — takes `{ clientId, slug }`; no FE gate; builds a `?client=<clientId>` `BrandingApi`; fetches via `useBrand(slug)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/branding-cards.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import AdminWorkspaceBrandingCard from '../../src/modules/branding/AdminWorkspaceBrandingCard';
import WorkspaceBrandingCard from '../../src/modules/branding/WorkspaceBrandingCard';
import { UserAuthCtxForTesting } from '../../src/modules/user-portal/user-auth-context';

beforeEach(() => {
  global.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
    if (typeof url === 'string' && url.includes('/api/public/brand/')) {
      return new Response(JSON.stringify({ name: 'Acme', logoUrl: null, logoAltUrl: null, faviconUrl: null, appIconUrl: null, socialUrl: null, heroUrls: [], accent: null, theme: 'dark', fontHeading: null, fontBody: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  }) as never;
});
afterEach(() => { vi.restoreAllMocks(); cleanup(); });

function withAuth(opts: { permissions: Record<string, true>; level_number?: number | null; slug?: string }) {
  return (
    <UserAuthCtxForTesting.Provider value={{
      user: { id: 'u-1', display_name: 'T', email: 't@x', level_number: opts.level_number ?? 5 } as never,
      client: { id: 'c-1', slug: opts.slug ?? 'acme', name: 'Acme' } as never,
      permissions: opts.permissions, enabledModules: [], loading: false,
      refresh: async () => {}, signOut: async () => {},
    }}>
      <WorkspaceBrandingCard />
    </UserAuthCtxForTesting.Provider>
  );
}

describe('WorkspaceBrandingCard visibility', () => {
  test('renders with _platform.settings.edit', async () => {
    render(withAuth({ permissions: { '_platform.settings.edit': true } }));
    await waitFor(() => expect(screen.getByText(/branding/i)).toBeTruthy());
  });
  test('null when no perm and level > 1', () => {
    const { container } = render(withAuth({ permissions: {}, level_number: 5 }));
    expect(container.textContent).toBe('');
  });
  test('L1 bypass renders without explicit perm', async () => {
    render(withAuth({ permissions: {}, level_number: 1 }));
    await waitFor(() => expect(screen.getByText(/branding/i)).toBeTruthy());
  });
});

describe('AdminWorkspaceBrandingCard', () => {
  test('renders and a theme change PATCHes with ?client=<id>', async () => {
    render(<AdminWorkspaceBrandingCard clientId="c-1234" slug="acme" />);
    await waitFor(() => expect(screen.getByText(/branding/i)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/light theme/i));
    await waitFor(() => {
      const calls = (global.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;
      const patch = calls.find(([u, o]) => typeof u === 'string' && u.includes('/api/client-settings/brand') && o?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect((patch![0] as string)).toContain('client=c-1234');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/branding-cards.test.tsx` → FAIL.

- [ ] **Step 3: Implement both wrappers**

Create `src/modules/branding/AdminWorkspaceBrandingCard.tsx`:

```tsx
import { useBrand } from './useBrand';
import { BrandingForm, type BrandingApi } from './BrandingForm';
import type { DownscaleKind } from './types';

export default function AdminWorkspaceBrandingCard({ clientId, slug }: { clientId: string; slug: string }) {
  const { brand, refetchKey } = useBrandWithRefetch(slug);
  const api: BrandingApi = {
    async uploadImage(kind: DownscaleKind, file: File) {
      const form = new FormData(); form.set('kind', kind); form.set('file', file);
      const r = await fetch(`/api/client-settings/brand-image?client=${encodeURIComponent(clientId)}`, { method: 'POST', credentials: 'include', body: form });
      if (!r.ok) throw new Error(`upload ${r.status}`);
      return r.json() as Promise<{ key: string }>;
    },
    async patch(body) {
      const r = await fetch(`/api/client-settings/brand?client=${encodeURIComponent(clientId)}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`patch ${r.status}`);
    },
  };
  return (
    <section className="brand-card">
      <h3>Branding</h3>
      <p>Logos, hero images, colors, and fonts for this workspace's customer-facing pages.</p>
      <BrandingForm brand={brand} api={api} onSaved={refetchKey} />
    </section>
  );
}

// Small helper so a save re-pulls the current brand. Defined inline to avoid
// a shared-state module; both cards use their own instance.
function useBrandWithRefetch(slug: string) {
  const { brand } = useBrand(slug);
  return { brand, refetchKey: () => { /* v1: BrandingForm updates optimistically; a full refetch hook is a follow-up */ } };
}
```

Create `src/modules/branding/WorkspaceBrandingCard.tsx`:

```tsx
import { useUserAuth } from '../user-portal/user-auth-context';
import { useBrand } from './useBrand';
import { BrandingForm, type BrandingApi } from './BrandingForm';
import type { DownscaleKind } from './types';

function canEdit(permissions: Record<string, true>, level_number: number | null | undefined): boolean {
  if (level_number == null || level_number === 1) return true;
  return permissions['_platform.settings.edit'] === true;
}

export default function WorkspaceBrandingCard() {
  const { permissions, user, client, loading } = useUserAuth();
  const slug = client?.slug ?? '';
  const { brand } = useBrand(loading ? null : slug);
  if (loading) return null;
  if (!canEdit(permissions, (user as { level_number?: number | null }).level_number)) return null;

  const api: BrandingApi = {
    async uploadImage(kind: DownscaleKind, file: File) {
      const form = new FormData(); form.set('kind', kind); form.set('file', file);
      const r = await fetch('/api/client-settings/brand-image', { method: 'POST', credentials: 'include', body: form });
      if (!r.ok) throw new Error(`upload ${r.status}`);
      return r.json() as Promise<{ key: string }>;
    },
    async patch(body) {
      const r = await fetch('/api/client-settings/brand', { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`patch ${r.status}`);
    },
  };

  return (
    <section className="brand-card">
      <h3>Branding</h3>
      <p>Logos, hero images, colors, and fonts for your workspace's customer-facing pages.</p>
      <BrandingForm brand={brand} api={api} />
    </section>
  );
}
```

Note: if `UserAuthCtxForTesting` isn't already exported from `user-auth-context.tsx`, it was added in the workspace-backup work; verify it exists (`grep UserAuthCtxForTesting src/modules/user-portal/user-auth-context.tsx`). If missing on this branch, add `export const UserAuthCtxForTesting = Ctx;` beside the context definition (same one-liner used by WorkspaceExportCard's tests).

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/branding-cards.test.tsx` → pass.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add src/modules/branding/WorkspaceBrandingCard.tsx src/modules/branding/AdminWorkspaceBrandingCard.tsx tests/unit/branding-cards.test.tsx src/modules/user-portal/user-auth-context.tsx
git commit -m "feat(branding): bucket-user + admin branding card wrappers

WorkspaceBrandingCard gates on _platform.settings.edit / L1 bypass and
self-scopes the API. AdminWorkspaceBrandingCard takes {clientId,slug} and
passes ?client=. Both compose the shared BrandingForm.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: mount both cards + full suite + smoke

**Files:**
- Modify: `src/modules/user-portal/pages/UserAccount.tsx` (mount `WorkspaceBrandingCard`)
- Modify: `src/modules/ams/pages/AccessDashboard.tsx` (mount `AdminWorkspaceBrandingCard`)

**Interfaces:**
- Consumes: the two default-export cards from Task 15.

- [ ] **Step 1: Mount on `UserAccount.tsx`**

Add the import near the other imports:
```ts
import WorkspaceBrandingCard from '../../branding/WorkspaceBrandingCard';
```
Mount it after the existing `<WorkspaceExportCard />` (from the workspace-backup work) near the end of the returned JSX:
```tsx
      <WorkspaceExportCard />
      <WorkspaceBrandingCard />
```
If `WorkspaceExportCard` is not present on this branch (it landed on a different feature branch not yet merged), mount `<WorkspaceBrandingCard />` at the same terminal position (just before the outer container's closing tag). Verify by reading the file first.

- [ ] **Step 2: Mount on `AccessDashboard.tsx`**

Add the import:
```ts
import AdminWorkspaceBrandingCard from '../../branding/AdminWorkspaceBrandingCard';
```
Mount it after `<ClientProductsSection clientId={clientId} />` near the end of the JSX. `clientSlug` is already loaded in the component (state populated by `loadSlug()`):
```tsx
        <ClientProductsSection clientId={clientId} />
        <AdminWorkspaceBrandingCard clientId={clientId} slug={clientSlug} />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` → clean.

- [ ] **Step 4: Full suite**

Run: `npm run test`
Expected: all green (all prior branding tests + the whole existing suite; no regressions). If a pre-existing unrelated failure appears (e.g. the POS `cart.ts` strict-typing debt noted in the workspace-backup branch), confirm it is NOT caused by this branch by checking it fails identically on `origin/main`; document it and proceed. Any failure traceable to branding code must be fixed.

- [ ] **Step 5: Local smoke (manual, best-effort)**

```bash
npm run build   # confirm the production bundle builds with fonts
```
If a dev server / prod smoke is available, verify:
- L1 Owner → `/c/:slug/account` shows the Branding card; uploading a logo + picking a font + toggling light theme persists (reload reflects it).
- Admin → `/clients/:clientId` shows the admin Branding card; changes persist under `?client=`.
- `curl -sS -o /dev/null -w '%{http_code}' https://<dev>/api/public/brand/<slug>` → 200; `/image/<key>` → 200 with `cache-control: public, max-age=86400`.
- Netlify new-function trap: probe all four new endpoints for 404s; if any 404, note `netlify api restoreSiteDeploy` for the deploy chat.

- [ ] **Step 6: Commit**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
test "$(git branch --show-current)" = "feat/platform-branding-iso" || { echo "WRONG BRANCH"; exit 1; }
git add src/modules/user-portal/pages/UserAccount.tsx src/modules/ams/pages/AccessDashboard.tsx
git commit -m "feat(branding): mount branding cards on Account + AccessDashboard

L1 Owners tune brand from /c/:slug/account; admins from /clients/:clientId.
Full suite green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Branding-WT"
npm run typecheck
npm run test
git log --oneline origin/main..HEAD
```
Expected: typecheck clean; full suite green; ~18 commits (spec + ADR + 16 tasks).

## Handoff to parallel chat

After all tasks complete, emit a "Work done." line + a paste-ready prompt for the deploy chat containing: branch `feat/platform-branding-iso`, HEAD SHA, the migration-050 note (additive, coordinate ordering), the new `@fontsource*` deps, the four new endpoints to probe post-deploy (Netlify new-function trap), and the spec §9 consume-contract pointer so the POS + Booking chats can start their refactor. Do NOT push or merge from this chat.

---

## Self-Review

**Spec coverage:**
- §3 migration 050 → Task 1. ✓
- §5.1 `_shared/brand.ts` → Task 2 (incl. the module-agnostic `resolveClientBySlug`). ✓
- §5.2 brand-image POST → Task 3. ✓
- §5.3 brand PATCH + cross-tenant guard → Task 4. ✓
- §5.4 public brand GET → Task 5. ✓
- §5.5 public image GET → Task 6. ✓
- §6.1 branding.ts helpers + allowlist → Task 7. ✓
- §6.9 downscale + §9.1 Brand type → Task 8. ✓
- §6.8 self-hosted fonts + deps → Task 9. ✓
- §6.4 useBrand → Task 10. ✓
- §6.2 BrandShell → Task 11. ✓
- §6.3 BrandHero → Task 12. ✓
- §6.7 CSS + barrel (§9.3 surface) → Task 13. ✓
- §6.5 settings form → Task 14; §6.5/§6.6 wrappers → Task 15. ✓
- Mounts → Task 16. ✓
- §7 tests: distributed across tasks (unit + integration). ✓
- §9 consume contract: barrel (Task 13) + handoff note. ✓

**Placeholder scan:** The BrandingForm and the hero-append are flagged as v1 simplifications with explicit code-comment notes, not silent gaps. The `sql.query` dynamic-update and Neon array-binding carry "verify against repo pattern" notes because the exact client method varies — these are verification instructions, not missing code. No "TODO"/"TBD".

**Type consistency:** `Brand`, `BrandKind`/`StableBrandKind`, `DownscaleKind`, `BrandingApi`, `brandKey`/`heroKey`/`isAllowedBrandKey`/`keyBelongsToClient`, `onAccent`, `isAllowlistedFont`, `BRAND_FONT_ALLOWLIST` — all defined once (Tasks 2, 7, 8) and consumed with matching signatures downstream. Endpoint field names (`logoKey`, `heroKeys`, `accent`, `theme`, `fontHeading`, `fontBody`) match between PATCH (Task 4), BrandingForm (Task 14), and the wrappers (Task 15). Column names match the migration (Task 1). Audit ops (`client.brand_image_uploaded`, `client.brand_updated`) consistent.

Known v1 scope trims documented in-plan (not gaps): hero drag-reorder/delete deferred to v1.1 (form appends); `useBrand` refetch-after-save is optimistic (full refetch is a follow-up). Both are called out in code comments so the reviewer sees them.
