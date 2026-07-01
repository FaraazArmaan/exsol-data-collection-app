# ADR 0001 — Storefront branding is a platform concern, not a POS feature

**Status:** Accepted (2026-06-30)
**Deciders:** workspace owner + POS chat. To be implemented by the Login + AMS chat; consumed by POS and Booking.

## Context
POS v3 (`feat/pos-v3-branding-iso`, complete, **not merged**) added per-tenant storefront branding — logo, accent color (free hex + auto-contrast, logo-seeded), hero banner, light/dark theme — scoped to the POS public storefront (`/menu/:slug*`).

The branding data already lives on the **`clients`** table (`storefront_logo_key`, `storefront_hero_key`, `storefront_accent`, `storefront_theme`) — i.e. it is already workspace-level data, not a POS table. But the *code* (helpers, application shell, public image endpoint, settings UI, CSS) sits inside the POS module.

Other modules already have customer-facing surfaces (Booking's public pages; future order-status pages, emailed receipts). If each module owns its own branding, tenants reconfigure brand per module and customers see inconsistent identity. Branding is tenant **identity**, used by many surfaces.

## Decision
Branding is a **platform-level** capability owned by the workspace (L1 Owner), configured once in the **workspace settings panel**, and consumed by every customer-facing surface (POS storefront, Booking, …).

1. **Data** lives on `clients`, renamed to a brand-neutral namespace: `brand_logo_key`, `brand_hero_key`, `brand_accent`, `brand_theme`. `storefront_enabled` stays POS-specific (it gates the POS storefront, not branding).
2. **A shared `branding` domain** holds the reusable code (FE `src/modules/branding/`, backend `_shared/brand.ts`): the `onAccent` contrast helper, `suggestAccentFromLogo` extractor, a `BrandShell`/`useBrand()` that applies `--accent`/`--text-on-accent`/`data-theme` custom properties, and the light-theme token set.
3. **Delivery is module-agnostic:** a public `GET /api/public/brand/:slug` → `{ name, logoUrl, heroUrl, accent, theme }`; a generic public image endpoint `GET /api/public/brand/:slug/image/:key` (ownership-validated). Any customer-facing surface fetches the brand and wraps its pages in `BrandShell`.
4. **Configuration** is a Branding card in the workspace settings panel, gated by `_platform.settings.edit` (not a POS settings page). Authed upload via `client-settings-brand`.
5. **Ownership:** the **Login + AMS chat** implements the shared domain (it owns settings + the `clients`/levels domain). POS and Booking are consumers.

## Consequences
- **Positive:** one brand set once; consistent customer experience; new customer-facing modules get branding for free by consuming the shared contract; security hardening (ownership checks, magic-byte sniffing — see the v3 review) lives in one place.
- **Cost:** the v3 POS-local code is refactored/relocated rather than merged as-is. Because v3 is **not yet merged** and the code is fresh + small, extraction now is cheap (a rename + relocation, not a rebuild). The v3 branch is the extraction starting point.
- **POS after extraction:** keeps `storefront_enabled` + its storefront pages, which wrap in `BrandShell` and fetch `/api/public/brand/:slug` instead of carrying branding columns/endpoints/helpers itself.
- **Migration:** a `clients` column rename (`storefront_*` → `brand_*` for logo/hero/accent/theme) — coordinate the migration number with sibling chats (Booking also touches `clients` migrations).

## References
- v3 spec: `docs/superpowers/specs/2026-06-30-pos-v3-branding-design.md`
- v3 plan: `docs/superpowers/plans/2026-06-30-pos-v3-branding.md`
- v3 branch (extraction source): `feat/pos-v3-branding-iso` @ `45937f6` (final review clean; 3 Important fixed)
- Session handoff trail: `docs/superpowers/handoffs/2026-06-30-pos-session-handoff.md`
