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
  - `branding.ts` — `isHexColor`, `onAccent`, `dominantColorFromPixels`, `suggestAccentFromLogo`, the curated font allowlist + `isAllowlistedFont`.
  - `downscale.ts` — `downscaleImage(file, kind)` client-side canvas downscaler (bounds every uploaded asset before POST).
  - `brand-fonts.ts` — aggregator that imports the self-hosted `@fontsource*` families in the allowlist (see §6.8). Imported once at app root.
  - `BrandShell.tsx` — applies `data-theme` + inline `--accent`/`--accent-hover`/`--text-on-accent`/`--brand-font-heading`/`--brand-font-body` custom properties; injects favicon/apple-touch-icon `<link>` tags; renders logo + hero carousel. (No runtime font `<link>` — fonts are self-hosted `@font-face`, lazy-fetched by the browser only when a family is actually referenced.)
  - `BrandHero.tsx` — hand-rolled auto-rotating carousel (5s, dots, prev/next, respects `prefers-reduced-motion`).
  - `useBrand.ts` — hook: `useBrand(slug) → { brand, loading, error }`.
  - `WorkspaceBrandingCard.tsx` — bucket-user settings card.
  - `AdminWorkspaceBrandingCard.tsx` — admin wrapper (mirrors the workspace-backup pattern).
- New `@fontsource*` npm dependencies for the ~14 allowlisted families (self-hosted WOFF2 static assets; see §6.8).
- CSS additions to `src/lib/components.css`:
  - Light-theme token overrides scoped to `[data-theme="light"]`.
  - `.brand-logo`, `.brand-hero`, `.brand-hero-carousel`, `.brand-card` styles.
  - Heading/body font application via `--brand-font-heading` / `--brand-font-body`.
- Consume contract (handback): TypeScript types + endpoint shapes documented in §9, so POS and Booking chats can refactor to it.

**Out of scope**

- Tenant-provided custom font file uploads (v1 self-hosts a curated allowlist; letting a tenant upload their own WOFF2 is v2).
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
| Font strategy | Curated **self-hosted** allowlist (~14 families via `@fontsource*`), heading + body separately | Industry-standard split (Shopify/Squarespace). Self-hosting the allowlist keeps all font requests same-origin: no third-party CDN, GDPR-clean (no visitor-IP logging by Google), no CSP `font-src` allowlist needed, faster (no extra DNS/connection). Allowlist still prevents arbitrary CSS injection — an unknown family has no `@font-face` and falls through to the system stack. Tenant-uploaded custom fonts deferred to v2. |
| Font loading mechanism | One global `brand-fonts.css` importing all allowlist `@fontsource*` families; browser lazy-fetches a WOFF2 only when a family is actually rendered | `@font-face` sources are lazy by spec — declaring 14 families costs nothing until one is used. Simpler than runtime `<link>` injection (no dedup/cleanup logic in `BrandShell`) and no FOUT-management code. |
| Uploaded image sizing | **Client-side canvas downscale** before POST, per kind (favicon→64px, app_icon→512px, logo→≤400px, social→≤1200px, hero→≤1600px), output WebP | A favicon `<link>` must not point at a multi-MB image on every branded page load. Canvas downscale bounds every asset with zero new deps and reuses the existing upload pipeline. The 5 MB server cap + magic-byte sniff remain the authoritative guard (client downscale is UX/perf, bypassable by a malicious client — so the server still validates). |
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
- `storefront_enabled` is **not** in this migration — it stays POS-specific and already shipped to prod via POS v2 migration `043_clients_storefront_enabled.sql`. POS needs no new migration for it.

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

Additionally exports the **curated self-hosted font allowlist** (families vendored via `@fontsource*`; see §6.8). Each entry's `family` string is the exact CSS `font-family` name the corresponding `@fontsource` package registers, so setting `--brand-font-heading: "Inter"` resolves against the self-hosted `@font-face`.
```ts
export const BRAND_FONT_ALLOWLIST: readonly {
  family: string;                                  // CSS font-family name (matches @fontsource)
  category: 'sans' | 'serif' | 'display' | 'mono';
  pkg: string;                                      // npm package to import in brand-fonts.css
  variable: boolean;                                // true → @fontsource-variable
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

No runtime URL builder is needed — the `@font-face` declarations come from the statically-imported `brand-fonts.css` (§6.8). `isAllowlistedFont` is used by the settings UI to gate the picker and by any consumer that wants to defensively validate a stored family before applying it.

### 6.2 `src/modules/branding/BrandShell.tsx`

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
  // @font-face (see §6.8) resolved via the --brand-font-* custom props above;
  // no runtime font <link> needed.
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

Save is per-section (PATCH partial). Every uploaded file is passed through `downscaleImage(file, kind)` (§6.9) before the POST — so the blob written is already bounded. Uploads happen inline (POST returns key → next PATCH includes it). No FE state machine beyond section-level `busy` flags.

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
- **Content column** (`.brand-main`): provides the centered content column that the POS storefront layout previously got from `.storefront-main` — `max-width` (~880px), horizontal auto-margins, and page padding. This is load-bearing: after POS renames `.storefront-shell`→`.brand-shell`, its `.storefront-main { max-width/padding }` layout rules stop matching, so `.brand-main` must carry the column or the storefront margins regress. (Per POS consume-review finding 2.) POS additionally re-scopes any narrower per-page rules — e.g. its centered checkout `max-width: 600px; margin: auto` — under `.brand-shell` itself; see §9.4.
- **Logo rules**: `.brand-logo` (max-height ~40px on mobile, 48px desktop, object-fit contain).
- **Hero rules**: `.brand-hero` (full-width, rounded corners, object-fit cover, capped height ~360px), `.brand-hero-carousel` (grid + dot pagination + chevron buttons).
- **Card rules**: `.brand-card` (mirrors `.ams-export-card` conventions after the workspace-backup theme fix); `.brand-card-section`; `.brand-upload-slot` (dashed border, hover state).
- **Font application**: `.brand-shell h1, .brand-shell h2, .brand-shell h3 { font-family: var(--brand-font-heading, inherit); }` and `.brand-shell { font-family: var(--brand-font-body, inherit); }`.

### 6.8 Self-hosted fonts — `src/modules/branding/brand-fonts.ts`

The ~14 allowlisted families are vendored as `@fontsource*` npm packages (self-hosted WOFF2 static assets, no third-party CDN). A single aggregator module imports them all; it is imported once at the app root (e.g. `src/main.tsx`), so every consumer surface has the `@font-face` declarations available.

```ts
// src/modules/branding/brand-fonts.ts  (imported once at app root)
// Each import registers @font-face for one allowlisted family. WOFF2 sources
// are lazy: the browser fetches a family's file only when something actually
// renders in that font-family, so importing all 14 costs ~0 until used.
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

Notes:
- Variable families (`@fontsource-variable/*`) register one WOFF2 covering all weights; non-variable families import the specific weights the allowlist declares.
- The exact package names must be verified against npm at implementation time (a couple may only exist as non-variable). The `pkg`/`variable` fields on `BRAND_FONT_ALLOWLIST` are the source of truth; keep the import list and the allowlist in sync.
- Bundle-size note: these are static font assets served on demand, NOT bundled into the JS. Total vendored footprint ≈ 1–1.5 MB across 14 families, and a given visitor only downloads the 0–2 families their tenant selected.

### 6.9 Client-side downscale — `src/modules/branding/downscale.ts`

Bounds every uploaded asset before it is POSTed, so no oversized blob (e.g. a multi-MB favicon) is ever stored or served.

```ts
export type DownscaleKind = 'logo' | 'logo_alt' | 'favicon' | 'app_icon' | 'social' | 'hero';

// Longest-edge cap per kind (px). Aspect ratio preserved; no upscaling.
const MAX_EDGE: Record<DownscaleKind, number> = {
  favicon: 64, app_icon: 512, logo: 400, logo_alt: 400, social: 1200, hero: 1600,
};

/**
 * Downscale `file` to the per-kind longest-edge cap and re-encode as WebP.
 * Returns a new File (WebP, name suffixed .webp). If the image already fits
 * and decode succeeds, still re-encodes to WebP for consistent output.
 * On any decode/encode failure, returns the original file unchanged (the
 * server-side 5 MB cap + magic-byte sniff remain the authoritative guard).
 */
export async function downscaleImage(file: File, kind: DownscaleKind): Promise<File> {
  try {
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

`image/webp` is in `BRAND_ALLOWED_MIME`, so downscaled output passes the server's magic-byte check. Favicon/app-icon transparency is preserved (WebP supports alpha).

## 7. Testing

### 7.1 Unit tests (~15)

Ported / new:
- `onAccent`: dark accent → white; light accent → black; borderline luminance = 0.45.
- `dominantColorFromPixels`: solid red image → returns a red hex; near-white/black rejected; low-saturation rejected.
- `suggestAccentFromLogo`: (skip in CI — needs `createImageBitmap`; smoke-test in browser).
- `isHexColor`: valid/invalid variants.
- `isAllowlistedFont`: family in / not in the allowlist; null/undefined → false.
- `downscaleImage`: (jsdom lacks `createImageBitmap`/canvas `toBlob` — assert the graceful-fallback path returns the original file when decode is unavailable; the real downscale is browser-smoke-tested). Assert `MAX_EDGE` caps are the intended values via a small exported accessor or by importing the constant.
- `sniffImageMime`: each of PNG/JPEG/GIF/WebP; WebP length-guard; unknown → null.
- `isAllowedBrandKey`: 5 stable kinds + hero pattern; foreign clientId rejected; typos rejected.
- `brandKey` / `heroKey`: format matches the regex.
- `useBrand`: success sets `brand`; HTTP error sets `error`; slug null → idle.
- `BrandShell`: sets `data-theme`; inline accent vars when accent set; inline `--brand-font-*` vars when family set; head-injection for favicon + apple-touch-icon on mount (NOT fonts — those are self-hosted `@font-face`); cleanup on unmount.
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
- **New npm dependencies:** ~14 `@fontsource*` packages (self-hosted font assets; static files, no runtime code). Verify each package name resolves on npm at implementation time. The carousel, font-picker, and image downscaler are hand-rolled (no deps). No new backend deps — `sharp` is explicitly avoided (client-side downscale handles sizing).
- Vite serves the `@fontsource` WOFF2 files as static assets; confirm the build emits them (they should appear under `dist/assets/`). No `external_node_modules` change needed (fonts are FE assets, not function deps).
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

This is the **pure brand page** pattern — the page's availability IS the brand's availability, so gating on `!brand` is correct here. Modules with their own availability gate (POS storefront: enabled + POS/products) must NOT gate on `!brand` — see the POS-specific note in §9.4.

```tsx
import { BrandShell, BrandHero, useBrand } from 'src/modules/branding';

function PureBrandPage({ slug }: { slug: string }) {
  const { brand, loading, error } = useBrand(slug);
  if (loading) return <SplashScreen />;
  if (error || !brand) return <NotAvailableCard />;   // OK only when brand-availability == page-availability
  return (
    <BrandShell brand={brand} fallbackName="Storefront">
      {brand.heroUrls.length > 0 && <BrandHero heroUrls={brand.heroUrls} />}
      {/* module-specific content: menu, booking widget, etc. */}
    </BrandShell>
  );
}
```

### 9.4 POS refactor recipe (executed by the POS chat after this lands)

Reviewed and confirmed by the POS chat. Findings from that review are folded in below (🔴 = consume-blocker, addressed).

1. **Drop** `src/modules/pos/lib/branding.ts` → replaced by `src/modules/branding/branding.ts`.
2. **Drop** `src/modules/pos/pages/StorefrontShell.tsx` → replace with `<BrandShell brand={...} fallbackName={tenantName}>`.
   - 🔴 **Layout (finding 2):** POS's storefront layout fix (margins) and centered-checkout rules are scoped under `.storefront-shell`/`.storefront-main` and stop matching after the rename. `.brand-main` now carries the content column (max-width + padding — see §6.7), so the base margins survive. POS must **re-scope its narrower per-page rules** (e.g. `.storefront-shell .pos-cart-page { max-width: 600px; margin: auto }`) under `.brand-shell` (`.brand-shell .pos-cart-page { … }`). Otherwise centered checkout regresses.
3. **Drop** the `branding` object from `pub-menu.ts` response and its Zod schema. Keep the product `thumbUrl` fields — but see step 5 for where those URLs point.
4. **Drop** `netlify/functions/_shared/storefront-branding.ts` → replaced by `_shared/brand.ts`.
5. 🔴 **(finding 1) Do NOT drop `pub-image.ts` outright — RETAIN it as a product-photo-only endpoint.** In POS v3 `pub-image` served BOTH brand images and `storefront_visible` product photos (its ownership check matched `brand_*` keys OR a product's `hero_image_key`). The new branding image endpoint (`/api/public/brand/:slug/image/:key`) validates **brand keys only** — it is intentionally module-agnostic (ADR-0001) and must not learn about the `products` table. Therefore:
   - **Decision:** branding stays brand-only; **POS keeps a product-image public endpoint.** Strip the brand-key branch from `pub-image.ts` so it validates only `storefront_visible`, active, non-deleted products' `hero_image_key` (optionally rename it `pub-product-image.ts` for clarity). `pub-menu`'s product `thumbUrl` continues to point at this POS-owned endpoint. This is required, not optional — dropping it with no replacement regresses product tiles to placeholders.
   - **Drop** `netlify/functions/client-settings-image.ts` (brand-image upload now lives in `client-settings-brand-image.ts` here).
6. **Slim** `netlify/functions/client-settings-storefront.ts` to only handle `{ enabled }` — remove `logoKey`, `heroKey`, `accent`, `theme`.
7. 🟡 **(finding 4) Migration:** **Drop the POS v3 migration 046** (`046_clients_storefront_branding.sql` — branding columns move to `brand_*` in this spec's migration 050; note v3's 046 also collided with `046_workspace_storage_quota` on main). **No new POS migration is needed for `storefront_enabled`** — it already shipped to prod via POS v2 migration 043 (`043_clients_storefront_enabled.sql`). In short: *drop 046; `storefront_enabled` is already live.*
8. **FE wiring:** POS storefront pages wrap themselves in `<BrandShell>` and call `useBrand(slug)` in parallel with `pub-menu` (two fetches; brand cached 1 min at Edge).
   - 🟡 **(finding 3) Availability:** POS must drive its "Online ordering isn't available" card off the **`pub-menu` 404** (which is storefront/products/pos-gated), NOT off the brand fetch. `resolveClientBySlug` is module-agnostic — a workspace can have a brand while its storefront is disabled. Apply the brand regardless; gate the *menu content* on the menu fetch. Do NOT use the §9.3 `if (!brand) return <NotAvailable>` pattern for the POS storefront.

### 9.5 Booking refactor (executed by the Booking chat)

Reviewed and confirmed by the Booking chat — a genuinely clean consume: **nothing to drop** (no `pos/lib/branding.ts` analog, no `StorefrontShell`, no branding endpoint, no dual-purpose `pub-image`), **no data-model change** (Booking owns no branding columns/endpoints/CSS), and the `[data-theme="light"]` tokens (§6.7) cascade into the `.booking-*` components cleanly (they hardcode zero hex colors; the only font is an intentional `var(--font-mono)`). The consume is purely additive: import `{ BrandShell, BrandHero, useBrand }` and wrap the public pages. Findings from that review are folded in below (all 🟡 recipe-fleshing; no blockers).

1. **Availability gating — use the §9.4 treatment, NOT §9.3.** Booking's page availability is defined by the *booking fetch*, not the brand. `ServicePicker` already does the right thing (services 404 → "This booking page doesn't exist"; empty → "No services available"). Render `<BrandShell brand={brand} fallbackName={tenantName}>` **best-effort** and keep gating content on the booking fetch. Do **not** copy §9.3's `if (!brand) return <NotAvailable>` — that couples a working booking page to the brand endpoint's health (a transient 429/error would hide it) and discards Booking's nicer 404/empty states. (§5.4 only 404s on an unknown slug — an existing tenant with no brand returns a default `Brand` — so `!brand` roughly coincides with Booking's own gate, but the coupling risk stands.) **Highest-priority tweak.**
2. **Container / layout.** Booking's roots are `.page-narrow.booking-storefront` / `.page-narrow.booking-manage` — global classes, never scoped under a shell class, so (unlike POS) there are **no orphaned rules to re-scope**. But `.page-narrow { max-width: 720px }` (no `margin: auto`) would nest inside `.brand-main`'s centered ~880px column. `.brand-main` already provides the single centered content column (`max-width` + `margin: 0 auto` + padding — §6.7), so **drop `.page-narrow` from the storefront roots** and let `.brand-main` be the column. (Alternatively keep `.page-narrow` and add `margin: auto` to it, but dropping it is cleaner and avoids a double column cap.)
3. **Early-return wrapping level.** `ServicePicker` and `ManageBooking` render their not-found / loading states via **early returns before the main render**. Wrap at a level that also covers those — either wrap the *route* in `<BrandShell>`, or wrap *inside* the component **above** its early returns — otherwise the "invalid link" / "doesn't exist" / loading states render unbranded.
4. **`ManageBooking` must read `slug`.** Its route is `/c/:slug/book/manage/:token`; it currently `useParams`-destructures only `token`. To call `useBrand(slug)` it must also read `slug` (available in the same `useParams`). One line.
5. **Forward flag — images.** Booking's public pages render **no images today** (service cards are text-only; the confirmation badge is CSS), so the brand-keys-only image endpoint (§5.5, ADR-0001) is sufficient — no blocker. **If Booking later adds service photos or staff avatars, it needs its own public image endpoint** (like POS's retained product-image endpoint). The branding image endpoint must **not** learn about Booking tables. See §10.

## 10. Open follow-ups (post-v1)

- Custom self-hosted font upload (WOFF2 pipeline).
- Live preview panel in the settings card.
- Per-slide carousel metadata (caption, CTA link, transition timing).
- SSR OG meta injection when SSR lands.
- Extending the font allowlist based on tenant demand.
- Automated color palette generation (accent + complementary + neutral) from primary logo.
- **Per-module public image endpoints** as consumers add customer-facing imagery: POS already retains a product-photo endpoint (§9.4); Booking will need one if it adds service photos / staff avatars (§9.5 finding 5). The shared branding image endpoint (§5.5) stays brand-keys-only per ADR-0001 — each module owns the ownership check for its own tables.
