# Platform Branding — Design Spec

**Date:** 2026-07-01
**Module:** Shared platform domain (AMS-owned; consumed by POS, Booking, future customer-facing modules)
**Status:** Drafted — awaiting user review
**Driving decision:** [ADR-0001 — Storefront branding is a platform concern, not a POS feature](../../adr/0001-branding-is-a-platform-concern.md)
**Extraction source:** `feat/pos-v3-branding-iso` @ `45937f6` (worktree `../ExSol-POS-v3-WT`) — POS-local implementation of logo + accent + hero + light/dark. NOT merged; this spec relocates and generalizes it.
**Predecessor spec (source):** [`2026-06-30-pos-v3-branding-design.md`](../../../../ExSol-POS-v3-WT/docs/superpowers/specs/2026-06-30-pos-v3-branding-design.md) — the POS-local spec being generalized.

---

## 1. Goal

Give the workspace owner (L1) a single Branding surface that shapes every customer-facing page — POS storefront, Booking public pages, order-status pages, emailed receipts (future) — with one coherent identity. **Logos** (primary + variants), a **hero carousel**, **accent color** with auto-contrast, **light/dark theme**, and **custom heading + body fonts**. Applied via a shared `BrandShell` that any module wraps its customer-facing pages in.

Success = one L1 Owner uploads their brand once, and every public surface (POS `/menu/:slug`, Booking `/book/:slug`, etc.) picks it up automatically.

## 2. Scope

**In scope**

- Migration `050_brand_columns.sql`: 11 new columns on `public.clients` in a brand-neutral namespace.
- New shared backend helper `netlify/functions/_shared/brand.ts` (blob store, magic-byte sniff, key format, ownership regex).
- New public endpoints `GET /api/public/brand/:slug` and `GET /api/public/brand/:slug/image/:key`.
- New authed endpoints `POST /api/client-settings/brand-image` and `PATCH /api/client-settings/brand`.
- New shared FE module `src/modules/branding/`:
  - `branding.ts` — `isHexColor`, `onAccent`, `dominantColorFromPixels`, `suggestAccentFromLogo`, curated Google Fonts allowlist.
  - `BrandShell.tsx` — applies `data-theme` + inline `--accent`/`--accent-hover`/`--text-on-accent`/`--brand-font-heading`/`--brand-font-body` custom properties; injects favicon/apple-touch-icon and Google Fonts `<link>` tags; renders logo + hero carousel.
  - `BrandHero.tsx` — hand-rolled auto-rotating carousel (5s, dots, prev/next, respects `prefers-reduced-motion`).
  - `useBrand.ts` — hook: `useBrand(slug) → { brand, loading, error }`.
  - `WorkspaceBrandingCard.tsx` — bucket-user settings card.
  - `AdminWorkspaceBrandingCard.tsx` — admin wrapper (mirrors the workspace-backup pattern).
- CSS additions to `src/lib/components.css`:
  - Light-theme token overrides scoped to `[data-theme="light"]`.
  - `.brand-logo`, `.brand-hero`, `.brand-hero-carousel`, `.brand-card` styles.
- Consume contract (handback): TypeScript types + endpoint shapes documented in §9, so POS and Booking chats can refactor to it.

**Out of scope**

- Custom self-hosted font uploads (v1 uses a curated Google Fonts allowlist; WOFF2 upload is v2).
- Per-slide carousel captions / CTA links / transition timing controls (v2 via JSONB).
- Custom domains, per-surface theme overrides, animations, live preview panel.
- SSR-injected OG meta tags (this spec stores the `social_key` and returns `socialUrl`; head-injection for share cards is a follow-up when SSR lands).
- POS/Booking refactor to the new contract (handback — those chats consume this spec).
- Migration data migration (POS v3 unmerged → no existing prod branding data to move).

## 3. Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Namespace | `brand_*` on `public.clients` | ADR-0001. Brand-neutral so Booking/future modules don't feel POS-shaped. |
| Migration approach | Fresh additive columns; POS v3 chat drops their unreleased mig 046 | POS v3 is unmerged; no prod data to rename. Cleanest. |
| Migration number | `050` (next free after prod 049) | Verified via memory + `git log origin/main`. Coordinate with Booking chat before locking. |
| Font strategy | Curated Google Fonts allowlist (~30 families), heading + body separately | Industry-standard (Shopify/Squarespace split). Allowlist prevents arbitrary CSS injection; Google Fonts loads via `<link>`. Custom uploads deferred to v2. |
| Logo kinds | 5 stable-key kinds: `logo`, `logo_alt`, `favicon`, `app_icon`, `social` | Matches Shopify + Squarespace + PWA/OpenGraph conventions. Enough for headers, inverse backgrounds, browser tabs, iOS/Android home-screen, and social share cards. |
| Hero storage | `text[]` array of blob keys with per-slide UUID | Ordered carousel; PATCH `heroKeys` array replaces atomically. Simpler than a child table. No per-slide metadata in v1. |
| Blob store name | `'brand'` (single store; kind encoded in key path) | Renamed from `'storefront-branding'`. Since POS v3 is unmerged, no prod blobs exist under the old name — no data migration. |
| Ownership check | Widened: key equals any stable brand-image key OR is present in `brand_hero_keys` array | Defense-in-depth; no blob enumeration. Copies the POS v3 approach verbatim, extended for the array. |
| Blob-key regex | `^brand/<uuid>/(logo|logo_alt|favicon|app_icon|social|hero/<uuid>)$` | UUID-scoped so cross-tenant keys are structurally impossible. |
| Magic-byte sniff | Kept verbatim from POS v3 `sniffImageMime()` | Anti-spoof: PNG/JPEG/GIF/WebP with length-guarded WebP header check. |
| Card location | Same as Workspace Backup: `UserAccount.tsx` (bucket) + `AccessDashboard.tsx` (admin) | Consistent with the workspace-backup relocation from the prior branch. Single mount pattern, no new page. |
| Permission gate | `_platform.settings.edit` (server) + L1 bypass via `requirePermission` | Same pattern as POS v3. Bucket-user card renders when `permissions['_platform.settings.edit']` OR `level_number === 1`. Admin card always renders. |
| Public endpoint separation | Branding is its own endpoint (`/api/public/brand/:slug`) NOT bundled into `pub-menu` | So Booking + future modules consume brand without pulling POS product data. `pub-menu` drops its `branding` object during POS handback. |
| Public image endpoint | `/api/public/brand/:slug/image/:key` | Sibling of the POS v3 `pub-image`. Ownership-validated, known-prefix store routing, `Cache-Control: public, max-age=86400`. |
| Font `<link>` injection strategy | Injected by `BrandShell` on mount; deduplicated globally by family+source key; cleaned up on unmount | Prevents duplicate loads if two BrandShells are mounted in the same tree (edge case). No FOIT/FOUT concerns beyond browser defaults. |

## 4. Data model — migration 050

```sql
-- migration: 050_brand_columns.sql
--
-- Adds a brand-neutral branding namespace to public.clients. Replaces the
-- POS v3 unreleased storefront_* naming (see ADR-0001). No data migration:
-- POS v3 is unmerged so no prod columns/blobs under the old names exist.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS brand_logo_key       text,
  ADD COLUMN IF NOT EXISTS brand_logo_alt_key   text,
  ADD COLUMN IF NOT EXISTS brand_favicon_key    text,
  ADD COLUMN IF NOT EXISTS brand_app_icon_key   text,
  ADD COLUMN IF NOT EXISTS brand_social_key     text,
  ADD COLUMN IF NOT EXISTS brand_hero_keys      text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS brand_accent         text,
  ADD COLUMN IF NOT EXISTS brand_theme          text    NOT NULL DEFAULT 'dark',
  ADD COLUMN IF NOT EXISTS brand_font_heading   text,
  ADD COLUMN IF NOT EXISTS brand_font_body      text;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_brand_theme_chk CHECK (brand_theme IN ('dark','light'));
```

Column semantics:

- `brand_*_key` columns store blob keys, not URLs. Public URLs are constructed as `/api/public/brand/:slug/image/<key>` at read time.
- `brand_hero_keys` is an ordered array; PATCH replaces atomically. Empty array = no hero rendered.
- `brand_accent` is null → theme's default accent applies. Hex format validated at PATCH boundary.
- `brand_font_heading` / `brand_font_body` are CSS family names (e.g. `Inter`, `Merriweather`). Null → theme's default font stack. Only names in the curated allowlist load remote fonts; unknown names fall through to system font stack.
- `brand_theme` defaults to `dark` (the app's current default).
- `storefront_enabled` is **not** in this migration — it stays POS-specific and is added by the POS v3 branch's own separate migration.

## 5. Backend

### 5.1 `netlify/functions/_shared/brand.ts`

```ts
import { getStore } from '@netlify/blobs';

export const BRAND_STORE_NAME = 'brand';
export const BRAND_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_BRAND_BYTES = 5 * 1024 * 1024;

export function brandStore() {
  return getStore({ name: BRAND_STORE_NAME, consistency: 'strong' });
}

export type StableBrandKind = 'logo' | 'logo_alt' | 'favicon' | 'app_icon' | 'social';
export type BrandKind = StableBrandKind | 'hero';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STABLE_KEY_RE = new RegExp(`^brand/${UUID}/(logo|logo_alt|favicon|app_icon|social)$`, 'i');
const HERO_KEY_RE   = new RegExp(`^brand/${UUID}/hero/${UUID}$`, 'i');

/**
 * Build the stable-overwrite key for the five singleton brand-image kinds.
 * Hero keys are minted separately with per-slide UUIDs — see `heroKey()`.
 */
export function brandKey(clientId: string, kind: StableBrandKind): string {
  return `brand/${clientId}/${kind}`;
}

export function heroKey(clientId: string, slideId: string): string {
  return `brand/${clientId}/hero/${slideId}`;
}

export function isAllowedBrandKey(key: string): boolean {
  return STABLE_KEY_RE.test(key) || HERO_KEY_RE.test(key);
}

/** Magic-byte sniff. Verbatim from POS v3; anti-spoof against browser-declared Content-Type. */
export function sniffImageMime(bytes: ArrayBuffer): string | null {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}
```

### 5.2 `POST /api/client-settings/brand-image` (authed)

Multipart form: `{ kind: BrandKind, file: Blob }`.

1. `authenticateForPermission(req, '_platform.settings.edit')` (L1 bypass via `requirePermission`).
2. `resolveClientIdOrRespond` → `clientId`.
3. Validate multipart, `kind ∈ {logo, logo_alt, favicon, app_icon, social, hero}`, `file instanceof Blob`, `BRAND_ALLOWED_MIME.has(file.type)`, `0 < file.size <= MAX_BRAND_BYTES`.
4. Read bytes; `sniffImageMime(bytes)` must return a value in `BRAND_ALLOWED_MIME` (anti-spoof).
5. Key derivation:
   - Stable kinds → `brandKey(clientId, kind)` (overwrites previous upload of same kind).
   - Hero → `heroKey(clientId, crypto.randomUUID())` (unique per slide).
6. `brandStore().set(key, bytes)`.
7. `logAudit({ op: 'client.brand_image_uploaded', clientId, targetType: 'client', targetId: clientId, detail: { kind, key } })`.
8. Returns `201 { key }`.

Errors: `400 multipart_required | invalid_multipart | invalid_kind | file_required | unsupported_mime | empty_file`, `401`, `403`, `405 method_not_allowed`, `413 file_too_large`.

### 5.3 `PATCH /api/client-settings/brand` (authed)

Body (all fields optional; only supplied fields change):
```ts
{
  logoKey?:      string | null;
  logoAltKey?:   string | null;
  faviconKey?:   string | null;
  appIconKey?:   string | null;
  socialKey?:    string | null;
  heroKeys?:     string[];              // full replacement
  accent?:       string | null;         // /^#[0-9a-fA-F]{6}$/
  theme?:        'dark' | 'light';
  fontHeading?:  string | null;         // any string; only allowlist names produce a link tag on the FE
  fontBody?:     string | null;
}
```

1. Same auth + client-scope pattern as `client-settings-brand-image`.
2. Validate each supplied field. Zod schema strict.
3. **Cross-tenant guard:** for every supplied `*_key` and every element of `heroKeys`, the key must match `isAllowedBrandKey(key)` AND its embedded UUID must equal `clientId`. Reject with `400 forbidden_cross_tenant_key` on mismatch (the audit trail is worth flagging clearly).
4. Update columns in one query (dynamic SQL — set only supplied fields).
5. `logAudit({ op: 'client.brand_updated', clientId, targetType: 'client', targetId: clientId, detail: { fields_changed: [...] } })`.
6. Returns `200 { ok: true }`.

Errors: `400 validation_failed | forbidden_cross_tenant_key`, `401`, `403`, `405`.

### 5.4 `GET /api/public/brand/:slug` (unauthenticated)

Response shape (see §9 for the exported TS type):
```ts
{
  name: string,
  logoUrl:      string | null,
  logoAltUrl:   string | null,
  faviconUrl:   string | null,
  appIconUrl:   string | null,
  socialUrl:    string | null,
  heroUrls:     string[],
  accent:       string | null,
  theme:        'dark' | 'light',
  fontHeading:  string | null,
  fontBody:     string | null,
}
```

1. Rate-limit `checkLimit(clientIp, 'brand', { perMinute: 60 })` — reuses `_pub-ratelimit`.
2. Slug → client via a **new** `_pub-brand.resolveBrandBySlug(slug)` helper (extracted from POS v3's `_pub-authz.resolveStorefront` — it currently checks POS-storefront-enabled which we don't want here since brand is module-agnostic). Returns `{ clientId, name } | null`.
3. If null → `404 not_found`.
4. Read the 11 columns; convert each `*_key` (or hero key from array) to `logoUrl` etc via `/api/public/brand/${slug}/image/${key}` (null → null).
5. Cache header: `public, max-age=60` (brand rarely changes; 1-min cache is a good balance).

### 5.5 `GET /api/public/brand/:slug/image/:key` (unauthenticated)

1. Rate-limit (60/min/IP).
2. Resolve slug → clientId; 404 if unknown.
3. Structural guard: `isAllowedBrandKey(key)` — else `404 not_found`. (No blob enumeration.)
4. Ownership check: key must equal `brand_logo_key OR brand_logo_alt_key OR brand_favicon_key OR brand_app_icon_key OR brand_social_key OR = ANY(brand_hero_keys)`. Otherwise `404 not_found`.
5. Known-prefix routing (defense-in-depth): `key.startsWith('brand/')` must be true. Otherwise `404`.
6. Stream from `brandStore().get(key, { type: 'arrayBuffer' })`; 404 if the blob is missing.
7. `Content-Type` from `sniffImageMime` (fallback `application/octet-stream`); `Cache-Control: public, max-age=86400`.

### 5.6 Netlify function config

Each of the 4 new functions declares:
```ts
export const config = { path: '/api/…', method: 'POST' | 'GET' | 'PATCH' };
```
Flat files under `netlify/functions/`. Per memory: subdir layout has known discovery traps; keep flat.

## 6. Frontend

### 6.1 `src/modules/branding/branding.ts`

Verbatim port of `pos/lib/branding.ts` (already tested in POS v3):
- `isHexColor`, `toRgb`, `onAccent` (WCAG relative luminance → `'#161616' | '#ffffff'`).
- `dominantColorFromPixels`, `suggestAccentFromLogo`.

Additionally exports the **curated Google Fonts allowlist**:
```ts
export const BRAND_FONT_ALLOWLIST: readonly {
  family: string;
  category: 'sans' | 'serif' | 'display' | 'mono';
  weights: readonly number[];
}[] = [
  { family: 'Inter',           category: 'sans',    weights: [400, 500, 600, 700] },
  { family: 'Roboto',          category: 'sans',    weights: [400, 500, 700] },
  { family: 'Open Sans',       category: 'sans',    weights: [400, 600, 700] },
  { family: 'Lato',            category: 'sans',    weights: [400, 700] },
  { family: 'Montserrat',      category: 'sans',    weights: [400, 600, 700] },
  { family: 'Poppins',         category: 'sans',    weights: [400, 500, 600, 700] },
  { family: 'Nunito',          category: 'sans',    weights: [400, 600, 700] },
  { family: 'Work Sans',       category: 'sans',    weights: [400, 500, 700] },
  { family: 'Merriweather',    category: 'serif',   weights: [400, 700] },
  { family: 'Playfair Display',category: 'serif',   weights: [400, 700] },
  { family: 'Lora',            category: 'serif',   weights: [400, 700] },
  { family: 'Source Serif Pro',category: 'serif',   weights: [400, 700] },
  { family: 'PT Serif',        category: 'serif',   weights: [400, 700] },
  { family: 'Crimson Pro',     category: 'serif',   weights: [400, 700] },
  { family: 'Bebas Neue',      category: 'display', weights: [400] },
  { family: 'Anton',           category: 'display', weights: [400] },
  { family: 'Righteous',       category: 'display', weights: [400] },
  { family: 'Fjalla One',      category: 'display', weights: [400] },
  { family: 'JetBrains Mono',  category: 'mono',    weights: [400, 500, 700] },
  { family: 'Fira Code',       category: 'mono',    weights: [400, 500, 700] },
  { family: 'Space Mono',      category: 'mono',    weights: [400, 700] },
  // …targeting ~30 total; exact list finalized during implementation
] as const;

export function isAllowlistedFont(family: string | null | undefined): boolean {
  if (!family) return false;
  return BRAND_FONT_ALLOWLIST.some((f) => f.family === family);
}

export function googleFontsLinkHref(families: readonly string[]): string | null {
  const allowed = families.filter(isAllowlistedFont);
  if (allowed.length === 0) return null;
  const familyParams = allowed.map((f) => {
    const meta = BRAND_FONT_ALLOWLIST.find((x) => x.family === f)!;
    return `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@${meta.weights.join(';')}`;
  }).join('&');
  return `https://fonts.googleapis.com/css2?${familyParams}&display=swap`;
}
```

### 6.2 `src/modules/branding/BrandShell.tsx`

```tsx
import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { onAccent, googleFontsLinkHref } from './branding';
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

  // Head-injection: favicon, apple-touch-icon, Google Fonts <link>.
  useEffect(() => {
    const created: HTMLElement[] = [];
    const upsert = (rel: string, href: string) => {
      const existing = document.querySelector(`link[rel="${rel}"][data-brand-shell="1"]`);
      if (existing) existing.setAttribute('href', href);
      else {
        const el = document.createElement('link');
        el.rel = rel;
        el.href = href;
        el.dataset.brandShell = '1';
        document.head.appendChild(el);
        created.push(el);
      }
    };
    if (brand?.faviconUrl) upsert('icon', brand.faviconUrl);
    if (brand?.appIconUrl) upsert('apple-touch-icon', brand.appIconUrl);
    const fontHref = googleFontsLinkHref([brand?.fontHeading, brand?.fontBody].filter(Boolean) as string[]);
    if (fontHref) upsert('stylesheet', fontHref);
    return () => { created.forEach((el) => el.remove()); };
  }, [brand?.faviconUrl, brand?.appIconUrl, brand?.fontHeading, brand?.fontBody]);

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

### 6.3 `src/modules/branding/BrandHero.tsx`

Auto-rotating carousel. ~60 LOC. Respects `prefers-reduced-motion` (pauses auto-rotate). Keyboard `ArrowLeft`/`ArrowRight`. Single-slide → static, no chrome. Dots + prev/next chevrons visible only on multi-slide.

```tsx
export function BrandHero({ heroUrls, interval = 5000 }: { heroUrls: string[]; interval?: number }) {
  const [idx, setIdx] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || heroUrls.length < 2) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % heroUrls.length), interval);
    return () => clearInterval(id);
  }, [reduce, heroUrls.length, interval]);
  // Left/Right arrow keys navigate; dots + chevrons visible on multi-slide.
  // Full implementation in code — sketch shown for shape.
  if (heroUrls.length === 0) return null;
  // …
}
```

### 6.4 `src/modules/branding/useBrand.ts`

```ts
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

### 6.5 `src/modules/branding/WorkspaceBrandingCard.tsx`

Bucket-user settings card. Uses `useUserAuth()` for slug + `_platform.settings.edit` + L1 bypass.

Sections (collapsible or stacked):
1. **Logos** — 5 upload slots (primary, alternate, favicon, app icon, social). Each shows current preview + delete + replace.
2. **Hero carousel** — grid of hero images with drag-reorder + add + delete. Empty → "Add hero" CTA.
3. **Colors** — accent color picker (hex input + swatch); "Suggest from primary logo" button runs `suggestAccentFromLogo` on the currently-uploaded primary. Theme toggle (dark / light).
4. **Typography** — heading + body font pickers, each a `<select>` populated from `BRAND_FONT_ALLOWLIST` grouped by category. Preview text at chosen font.

Save is per-section (PATCH partial). Uploads happen inline (POST returns key → next PATCH includes it). No FE state machine beyond section-level `busy` flags.

Mounts on `/c/:slug/account` after the `<WorkspaceExportCard />`.

### 6.6 `src/modules/branding/AdminWorkspaceBrandingCard.tsx`

Admin wrapper. Takes `{ clientId, slug }` props. Same UI as the bucket-user card, but:
- No FE permission gate (server enforces `_platform.settings.edit`; admins always pass).
- Uses `?client=<clientId>` on the PATCH + upload URLs.

Mounts on `/clients/:clientId` (AccessDashboard) after `<AdminWorkspaceExportCard />`.

### 6.7 CSS additions to `src/lib/components.css`

- **Light-theme token overrides** scoped to `[data-theme="light"]`:
  - `--bg-base`, `--bg-surface`, `--bg-elevated` → warm cream palette.
  - `--border-subtle`, `--border-default`, `--border-strong` → light greys.
  - `--text-primary`, `--text-secondary`, `--text-muted` → dark warm.
  - `--accent`, `--text-on-accent` come from inline props (theme-independent).
- **Brand-shell layout**: `.brand-shell` full-height, uses `--brand-font-body` for body text; `.brand-header` centered logo strip.
- **Logo rules**: `.brand-logo` (max-height ~40px on mobile, 48px desktop, object-fit contain).
- **Hero rules**: `.brand-hero` (full-width, rounded corners, object-fit cover, capped height ~360px), `.brand-hero-carousel` (grid + dot pagination + chevron buttons).
- **Card rules**: `.brand-card` (mirrors `.ams-export-card` conventions after the workspace-backup theme fix); `.brand-card-section`; `.brand-upload-slot` (dashed border, hover state).
- **Font application**: `.brand-shell h1, .brand-shell h2, .brand-shell h3 { font-family: var(--brand-font-heading, inherit); }` and `.brand-shell { font-family: var(--brand-font-body, inherit); }`.

## 7. Testing

### 7.1 Unit tests (~15)

Ported / new:
- `onAccent`: dark accent → white; light accent → black; borderline luminance = 0.45.
- `dominantColorFromPixels`: solid red image → returns a red hex; near-white/black rejected; low-saturation rejected.
- `suggestAccentFromLogo`: (skip in CI — needs `createImageBitmap`; smoke-test in browser).
- `isHexColor`: valid/invalid variants.
- `isAllowlistedFont`: family in / not in the allowlist.
- `googleFontsLinkHref`: builds correct URL for supplied families; returns null for empty or unknown-only.
- `sniffImageMime`: each of PNG/JPEG/GIF/WebP; WebP length-guard; unknown → null.
- `isAllowedBrandKey`: 5 stable kinds + hero pattern; foreign clientId rejected; typos rejected.
- `brandKey` / `heroKey`: format matches the regex.
- `useBrand`: success sets `brand`; HTTP error sets `error`; slug null → idle.
- `BrandShell`: sets `data-theme`; inline accent vars when accent set; inline font vars when family set; head-injection for favicon/apple-touch/fonts on mount; cleanup on unmount.
- `BrandHero`: single slide static; multi-slide auto-rotates; `prefers-reduced-motion` pauses; keyboard navigation.

### 7.2 Integration tests (~10)

- Migration 050 adds all 11 columns + CHECK constraint.
- `POST /api/client-settings/brand-image`:
  - Each valid kind → 201 with the expected key format.
  - Mime spoof (declare PNG, send JPEG) → 400 `unsupported_mime`.
  - Oversize (>5MB) → 413.
  - No auth → 401; wrong perm → 403.
- `PATCH /api/client-settings/brand`:
  - Partial update sets only supplied fields.
  - `accent = '#zzz'` → 400 `validation_failed`.
  - `theme = 'purple'` → 400.
  - `heroKeys` array replaces atomically.
  - Foreign-tenant `logoKey` → 400 `forbidden_cross_tenant_key`.
- `GET /api/public/brand/:slug`:
  - Known slug → 200 with full shape; unknown → 404; unset fields → nulls.
  - Cache-Control header set.
- `GET /api/public/brand/:slug/image/:key`:
  - Owned key → 200 with `Cache-Control: public, max-age=86400`.
  - Foreign key → 404 (leak guard).
  - Unknown-prefix key → 404.
  - Rate-limit exhaust → 429.

### 7.3 Explicitly NOT tested in v1

- Live preview panel in the settings card (deferred).
- SSR OG meta injection (deferred — no SSR in v1).
- Custom font upload (deferred).
- Carousel captions / CTA links (deferred).

## 8. Deployment

- Migration 050 is additive → standard deploy order (code first is safe; migration first is also safe).
- No new env vars.
- No new npm dependencies (carousel + font-picker hand-rolled; Google Fonts uses public CDN).
- Post-deploy smoke:
  1. Probe the 4 new endpoints via curl (`/api/public/brand/:slug`, `/api/public/brand/:slug/image/:key`, `POST /api/client-settings/brand-image` with a real cookie, `PATCH /api/client-settings/brand`). Expect 401/404 on the public ones without a real seeded workspace; expect 405 on wrong method.
  2. Netlify new-function trap: check for 404 on the four new endpoints. If any 404s, `netlify api restoreSiteDeploy` per the memory note.
- Coordinate migration `050` with sibling chats (Booking is the only other chat that may add `clients` columns concurrently).

## 9. Consume contract (handback for POS + Booking)

The POS and Booking chats consume this contract to refactor their customer-facing pages.

### 9.1 TypeScript types

```ts
// src/modules/branding/types.ts (exported)
export interface Brand {
  name: string;
  logoUrl:      string | null;
  logoAltUrl:   string | null;
  faviconUrl:   string | null;
  appIconUrl:   string | null;
  socialUrl:    string | null;
  heroUrls:     string[];
  accent:       string | null;
  theme:        'dark' | 'light';
  fontHeading:  string | null;
  fontBody:     string | null;
}
```

### 9.2 Public endpoints

```
GET  /api/public/brand/:slug              → Brand
GET  /api/public/brand/:slug/image/:key   → image bytes; Cache-Control: public, max-age=86400
```

### 9.3 FE consumption pattern

```tsx
import { BrandShell, BrandHero, useBrand } from 'src/modules/branding';

function PublicPage({ slug }: { slug: string }) {
  const { brand, loading, error } = useBrand(slug);
  if (loading) return <SplashScreen />;
  if (error || !brand) return <NotAvailableCard />;
  return (
    <BrandShell brand={brand} fallbackName="Storefront">
      {brand.heroUrls.length > 0 && <BrandHero heroUrls={brand.heroUrls} />}
      {/* module-specific content: menu, booking widget, etc. */}
    </BrandShell>
  );
}
```

### 9.4 POS refactor recipe (executed by the POS chat after this lands)

1. **Drop** `src/modules/pos/lib/branding.ts` → replaced by `src/modules/branding/branding.ts`.
2. **Drop** `src/modules/pos/pages/StorefrontShell.tsx` → replace with `<BrandShell brand={...} fallbackName={tenantName}>`.
3. **Drop** the `branding` object from `pub-menu.ts` response and its Zod schema.
4. **Drop** `netlify/functions/_shared/storefront-branding.ts` → replaced by `_shared/brand.ts`.
5. **Drop** `netlify/functions/client-settings-image.ts` and `netlify/functions/pub-image.ts` (the branding path is handled here; product images stay in their own store and get their own separate public endpoint if needed).
6. **Slim** `netlify/functions/client-settings-storefront.ts` to only handle `{ enabled }` — remove `logoKey`, `heroKey`, `accent`, `theme`.
7. **Drop** the POS v3 migration 046 (columns move to `brand_*` per this spec's migration 050); keep only `storefront_enabled` in a slim POS-specific migration if it's not already applied.
8. The POS storefront pages wrap themselves in `<BrandShell>` and call `useBrand(slug)` in parallel with `pub-menu` (two fetches; brand cached 1 min at Edge).

### 9.5 Booking refactor (executed by the Booking chat)

Wrap the public booking pages in `<BrandShell>` fetched via `useBrand(slug)`. No data model changes on Booking's side.

## 10. Open follow-ups (post-v1)

- Custom self-hosted font upload (WOFF2 pipeline).
- Live preview panel in the settings card.
- Per-slide carousel metadata (caption, CTA link, transition timing).
- SSR OG meta injection when SSR lands.
- Extending the font allowlist based on tenant demand.
- Automated color palette generation (accent + complementary + neutral) from primary logo.
