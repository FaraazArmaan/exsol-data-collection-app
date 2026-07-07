# Ecommerce (ERP12) DEPTH — living handoff

Worktree: `ExSol-Ecommerce-WT` · branch `feat/ecommerce-depth-iso` (from `main` @ efcb588).
Migrations reserved **124–130**. NEVER push (hook blocks) / merge. `.env` copied in (dev branch
`ep-bold-wildflower`). Module surface = `pos` (staff, frozen `pos.*` action keys) + `catalog`
(public website) + storefront (`/menu/:slug`, `/catalog/:slug`, guest checkout `pub-sale-create`).

## Permission mapping (iron rule 3 — pos.* keys FROZEN, reused deliberately)
- Coupons + Bundles staff → `pos.sale.refund` (privileged/financial, manager tier).
- Reviews moderation → `pos.history.viewAll` (manager tier).
- L1 Owner bypasses in requirePos + every RouteMount mirrors the same key + navLink viewKeys.

## Status (one commit per feature)
- [x] F1 mobile breakpoints /catalog (560px) — `ade75ee` (CSS only)
- [x] F2 coupons — `68d3233` · mig 124 · coupons + coupon_redemptions; pos-coupons(/-detail),
  pub-coupon-validate, pub-sale-create discount; `_shared/coupons.ts` pure eval; CouponsPage.
- [x] F3 reviews & Q&A — `d75e157` · mig 125 · product_reviews; pub-review-create/pub-reviews,
  pos-reviews(/-detail); StorefrontReviews on catalog; ReviewsPage moderation.
- [x] F4 bundles — `43b950e` · mig 126 · product_bundle_items; `_shared/bundles.ts` loadBundles
  (stock derivation) wired into pub-menu/pub-catalog/pub-sale-create; pos-bundles(/-detail);
  ProductTile badge+sold-out; BundlesPage.
- [x] F5 abandoned cart email — `70a3840` · mig 127 · abandoned_carts; pub-cart-save (email-blur
  persist) + convert-on-sale; abandoned-cart-cron (*/15) → deliver(); sweepAbandonedCarts() export.
- [x] F6 tax/VAT — `3fb7b35` · mig 128 · client_tax_config; `_shared/tax.ts` computeTax; pos-tax +
  TaxPage + pub-storefront-config; details page shows tax line + formatMoney(currency). Inclusive
  tax stores tax_cents=0 (sales_total_matches CHECK is exclusive) → breakdown display-only.
- [x] F7 storefront CMS — `7f5b262` (+ XSS fix `c958b6a`) · mig 129 · storefront_cms; pos-storefront-cms
  (strict hero+banners, ctaHref sanitized) + StorefrontCmsPage; pub-menu renders when published.
- [x] F8 marketplace sync — `b259e9e` · NO migration (slot 130 free) · pos-marketplace-feed reuses
  `_shared/exporters` via new `_shared/exporters/build-rows.ts` (storefront-scoped); MarketplacePage.

## DONE — all 8 features shipped. Migrations 124–129 used; **130 free** (returned to pool).
Full suite green **1750/1750** @ HEAD `08da16d`; typecheck clean. Ready for Main integration.
New pos navLinks (all `pos.sale.refund` except Reviews `pos.history.viewAll`): Coupons, Reviews,
Bundles, Tax, Storefront, Marketplace. All ride the frozen `pos.*` keys (iron rule 3) with L1 bypass.

## Conventions locked in this run
- Neon driver has NO sql-fragment composition — never nest `sql`...``; read-merge-write in JS.
- jsonError shape `{ error: { code } }`; api.ts call() reads `body.error.code`.
- Migration style: multi-line CREATE ok, `;` at EOL, comments own line. gen_random_uuid() default,
  `create trigger X before update ... execute function public.set_updated_at();` one line.
- Tests: `tests/pos/_helpers.ts` (seedStorefrontClient / seedClientWithProductsEnabled+cookie /
  seedProducts / makeBucketUserRequest). Mock `@netlify/blobs` getStore in every pub-* test.
  Full run before handoff; `set -o pipefail` when grepping vitest.
- Seed grows in `scripts/seed-ecommerce.ts` (npm run seed:ecommerce) against Papa's Saloon.

## Known deferrals
- Coupon per-customer cap is best-effort count (global cap race-safe via conditional UPDATE).
- Coupon reserve-before-insert leaks one redeemed_count if order_no allocation 500s (rare).
- Bundle create/delete non-transactional (matches codebase); validate-first minimizes orphans.
- Tax inclusive mode stores tax_cents=0 (schema CHECK is additive); the extracted GST is
  display-only (storefront preview). Full inclusive persistence needs a schema change.
- Abandoned-cart per-customer/session TOCTOU minimal; cron marks 'reminded' on deliver().ok
  (dev logs count). Reminder email uses process.env.URL for the storefront link (empty → no link).
- Marketplace feed: build-rows.ts duplicates u-products-export's row mapping (left untouched to
  avoid regression) — consolidate if a third caller appears. Feed references image FILENAMES (no
  bytes bundled — use u-products-export for the full image ZIP).
- Post-deploy: probe new pub-*/pos-* routes (integration tests bypass name-based routing);
  register the abandoned-cart-cron schedule; verify dark theme + 560px in a REAL browser.
- Verify dark theme + mobile in a REAL browser (jsdom can't; iron rule 9).
