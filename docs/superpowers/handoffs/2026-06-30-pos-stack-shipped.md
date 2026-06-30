# POS v1 stack complete + storefront staged — Handoff

**Last updated:** 2026-06-30 (live; appended at every milestone)
**Branch:** `main` (origin synced)
**Latest commit:** `e52da02 docs(pos): session handoff trail (all POS branches)` (tip of cherry-picked v2 stack)
**Prod URL:** https://exsoldatacollectionapp.netlify.app
**Test count:** 821 tests / 112 files at HEAD · typecheck + build clean
**Working tree:** clean (untracked: smoke artifact PNGs `pos-menu-after.png`, `prod-pos-*.png`, `prod-storefront-*.png`, `arch-*.png`)

> **Convention for this file:**
> Sections marked `<!-- OVERWRITE -->` get rewritten on every milestone.
> Sections marked `<!-- APPEND -->` get new entries added underneath; existing entries are immutable.
> The "Milestone trail" is the durable session memory — never delete entries, only add.

---

## TL;DR for the next agent <!-- OVERWRITE -->

**POS v1 + POS v2 storefront BOTH live on prod end-to-end.** Today's session closed three POS perm-model findings (L1 access, L2+ action delegation admin UI, kiosk register CSS), shipped one cart-quantity UX fix, AND landed the entire POS v2 public storefront (3 migrations + 4 functions + FE). Final smoke flows verified on `papa-s-saloon` for both surfaces — staff sold sale S-00002 via the kiosk, an anonymous guest placed order S-00003 via the storefront. Each surface produces correctly distinct sales rows (`source: 'instore'` vs `'storefront'`) and audit entries.

**Most important next steps:**
1. **`exsol.app` DNS** — `PUBLIC_BASE_URL` env points there but DNS doesn't resolve. Storefront receipts will dead-link until configured. Two paths: buy + alias the domain, or temporarily set env to the app domain.
2. **Booking branch needs migration renumber** — currently claims 043/044/045 with filenames that don't conflict on disk but would confuse anyone reading the directory now that POS v2's 043/044/045 are applied to prod.
3. **Storefront chrome CSS** — `.storefront-*` wrapper classes (shell/header/unavailable/settings) have no rules. Menu/tile/cart styling inherits from POS stylesheet so the visible content looks right; only the chrome is plain.

**Two pre-existing UX gaps surfaced during smoke (not regressions):** (a) SaleDetailDrawer doesn't auto-refetch after a state-button click — reload fixes display. (b) StorefrontSettings page has no sidebar link.

---

## Current state on prod <!-- OVERWRITE -->

| Metric | Value |
|---|---|
| `origin/main` HEAD | `e52da02` |
| Local `main` HEAD | `e52da02` (synced) |
| Latest Netlify deploy | `ready` at commit `e52da02` (after `restoreSiteDeploy` post-push) |
| Migrations applied to prod (`dawn-bird`) | 001–045 (043 `clients_storefront_enabled`, 044 `products_storefront_visible`, 045 `sales_source` + nullable creator + CHECK applied this session) |
| **Functions registered** | 68 total — including 4 new public/storefront: `pub-menu`, `pub-sale-create`, `pub-sale-detail`, `client-settings-storefront` (path: `/api/client-settings/storefront` with slash) |
| **POS v1 endpoints** | All reachable: `/api/pos/menu`, `/api/pos/sales` (GET+POST), `/api/pos/sales/:id`, `/api/pos/sales/:id/state` |
| **POS v2 storefront endpoints** | All reachable: `/api/public/menu/:slug`, `/api/public/sales` POST, `/api/public/sales/:uuid` GET, `/api/client-settings/storefront` GET/PATCH |
| **PUBLIC_BASE_URL env (prod)** | `https://exsol.app` — **DNS not configured yet**, so receipt links will be unreachable until domain is purchased/aliased OR env is changed to `https://exsoldatacollectionapp.netlify.app` |
| Prod sales on `papa-s-saloon` | S-00001 `d144307a-…` (staff, prior session) · S-00002 `f6ca9edc-…` (staff, today) · S-00003 `050e97fc-…` (storefront/guest, today) — all evidence rows, harmless |
| **`papa-s-saloon` storefront state** | **enabled** (toggled on during this session's smoke at `/c/papa-s-saloon/pos/settings`) |

---

## Active worktrees & branches <!-- OVERWRITE -->

```
.../ExSol Data Collection App                main                              ab18c53  ← prod & local in sync
.../ExSol-Booking-WT                         feat/booking-module-iso           e17088f
.../ExSol-Login-AMS-WT                       feat/ams-workspace-backup-ui-iso  f8b67a3
.../ExSol-POS-WT                             feat/pos-module-iso               69df370  (stale; the main POS branch — superseded)
.../ExSol-POS-PermFix-WT                     feat/pos-action-perms-iso         1283c4d  (merged via cherry-pick)
.../ExSol-POS-CSS-WT                         feat/pos-stylesheet-iso           d8519c0  (merged via cherry-pick)
.../ExSol-POS-CartQty-WT                     fix/pos-cart-qty-iso              0ce215d  (merged via cherry-pick)
.../ExSol-POS-v2-WT                          feat/pos-v2-storefront-iso        ???      ← BACKEND COMPLETE, not pushed
.../ExSol-Product-Manager-WT                 feat/product-manager-iso          05b189f
```

The two stale entries (`feat/pos-module-iso`, `feat/ams-workspace-backup-ui-iso`) are safe to leave; they were the trunks the sibling chats branched off but are now behind main.

---

## Open threads / queued work <!-- OVERWRITE -->

1. **`exsol.app` DNS** — `PUBLIC_BASE_URL` is set to `https://exsol.app` on prod but the domain doesn't resolve. Receipt URLs in storefront responses point to this unreachable host. Two paths: (a) buy the domain + add Netlify alias + cert; (b) change env to `https://exsoldatacollectionapp.netlify.app` for now. The functional storefront flow works on the native app domain regardless of this.

2. **Storefront shell CSS missing** — `.storefront-*` wrapper classes (shell, header, unavailable, settings) have no rules yet per the sibling's note. The menu/tiles/cart/pills inherit the POS stylesheet correctly (so the working bits look styled in screenshots); only the chrome wrapper is plain. Owned by POS sibling for a follow-up CSS-only slice.

3. **StorefrontSettings discoverability** — `/c/<slug>/pos/settings` page exists and works but has no sidebar link. The AMS chat owns placing it in a proper Settings page eventually.

4. **Booking migration renumbering** — Booking branch (`feat/booking-module-iso`) claims migrations 043/044/045 with distinct filenames (`043_booking_core`, `044_bookings`, `045_booking_customer_phone_idx`). With POS v2's 043-045 now applied to prod, the Booking chat MUST renumber to 046+ before its own merge cycle to avoid confusion (the runner keys by full filename so they technically coexist, but two "043" entries in the dir is a footgun).

5. **SaleDetailDrawer auto-refetch** (UX, NOT blocking) — after clicking a state-transition button, the React component doesn't re-fetch the sale; reload reveals the correct state. Pre-existing, surfaced during today's POS v1 smoke. Send back to POS sibling chat with one-line useEffect fix when convenient.

6. **Hardcoded `level_number: 1`** in `pos-sale-state.ts` / `pos-sale-create.ts` audit session object. Phase 2 means L2+ can now reach these endpoints, so audit rows misattribute level. Low priority but worth fixing for audit fidelity.

7. **Permission validator vs `posProduct.requires: ['products']`** — defense-in-depth. Currently safe because runtime enable-gate enforces it, but a `requires` check in the validator would prevent the gate ever being bypassed.

8. **Architecture doc** at `docs/architecture.html` — served at `http://localhost:9911/architecture.html` via a Python http.server. Includes §1.7 Customer-Facing URLs + §2.5 Booking Module Flow. **Should be updated** to reflect that POS v2 storefront is now live (move from "spec locked, building" to "live"). May add a Storefront-specific flow diagram.

9. **Booking module** — spec locked per session memory, building. Active on `feat/booking-module-iso`. Not yet on a worktree integrated to main.

10. **Sibling handoff conflict** — POS sibling chat also wrote `docs/superpowers/handoffs/2026-06-30-pos-session-handoff.md` (came in with the v2 cherry-pick). My handoff at `2026-06-30-pos-stack-shipped.md` (this file) and theirs cover overlapping ground. Worth reconciling next session — either merge into one or split by perspective (this one is mainframe-centric; theirs is POS-sibling-centric).

---

## Operational learnings consolidated this session <!-- OVERWRITE -->

Two memories were added EARLIER today (now in `MEMORY.md`):
- [`feedback_netlify_subdir_function_discovery`](../../../memory/feedback_netlify_subdir_function_discovery.md) — `netlify/functions/<folder>/` is one function; sibling files inside are silent helpers. Distinct from new-function-404.
- [`feedback_netlify_config_path_method`](../../../memory/feedback_netlify_config_path_method.md) — two functions can't share `config.path` without `config.method` discrimination.

Patterns refined (no new memory entries; just reinforced):
- **Hash triple diagnostic** from `feedback_netlify_cache_clear` paid off twice this session. Pattern: `local-build hash = per-deploy-URL hash ≠ alias hash` → alias-not-promoted, fix is `restoreSiteDeploy`. Pattern: `alias hash = per-deploy-URL hash ≠ local-build hash` would be stale build cache (didn't see it today). The new doc in `docs/architecture.html#traps` now codifies the diagnostic with examples.
- **JSX-shape-changing pushes trip the alias-not-promoted trap reliably.** Across the 6 pushes today: pushes that added a new netlify/functions/*.ts file → tripped trap. Pushes that added new chunks (CSS+JS) → tripped trap. Pushes that touched only existing files → did NOT trip trap (e.g. the cart-qty fix tripped because JS chunk hash changed; the L1-access fix did NOT). Worth confirming over more pushes before promoting to a memory.
- **`createSiteBuild --clear-cache=true` is a no-op for the alias trap.** The Netlify Web UI "Clear cache and deploy" button is documented as the only fix for stale build cache, but the API surface I tried did nothing. Confirmed: the API flag is functionally a no-op for both traps we've seen.

---

## Milestone trail <!-- APPEND -->

### 2026-06-30 — Session start
- Resumed on `1283c4d` (Phase 2 action-perms admin UI already FF'd locally from prior day's POS-PermFix branch, awaiting push)
- POS-CSS sibling chat shipped `d8519c0` (stylesheet) — cherry-picked onto main → `dab6376`
- Pushed `69df370..dab6376` (3 commits: L1-access + action-perms + stylesheet). First deploy hit alias-not-promoted; `restoreSiteDeploy` fixed
- Verified all 31 `.pos-*` rules now in prod CSS, all 5 endpoints respond JSON-401

### 2026-06-30 — Architecture doc landed
- Wrote `docs/architecture.html` (53 KB, 1224 lines, single-file with embedded SVG diagrams)
- Initially at `/tmp/exsol-architecture.html`; moved to `docs/architecture.html` per user feedback "stop using temp"
- Served via Python http.server on :9911
- Covers HLD (system context, architecture, stack, multi-tenancy, modules, deployment) + LLD (auth flow, perms, data model, POS FSM, API patterns, audit, traps)

### 2026-06-30 — POS-CartQty fix landed
- Sibling chat shipped `0ce215d` (cart can decrement + remove) on `fix/pos-cart-qty-iso` (off `69df370`)
- Cherry-picked onto `dab6376` → `ab18c53`
- 52/52 POS FE tests green
- Pushed `dab6376..ab18c53`; alias-not-promoted trap fired again (predicted by the new doc); `restoreSiteDeploy` fixed
- Verified bundle: new JS `index-D6v_enW6.js`, `setQty` (3 refs) + `removeLine` (4 refs) wired

### 2026-06-30 — Architecture doc extended
- Added §1.7 "Customer-Facing URLs" — 3 hosting patterns (path/subdomain/custom domain), SVG diagram, resolver pseudo-code, operator-setup recipe, edge case callouts
- Added §2.5 "Booking Module Flow" — customer journey swimlane SVG, GIST `EXCLUDE` constraint for no-overbooking, per-service payment policy table, timezone callout
- Split "Build cache + alias-not-promoted" operational trap row into two distinct rows with the diagnostic procedure
- Renumbered §2.6/§2.7/§2.8 accordingly + TOC updated

### 2026-06-30 — Prod UI smoke executed
- Signed in as Faraaz (Owner) on `papa-s-saloon`
- Fresh JS bundle confirmed (`index-D6v_enW6.js`)
- `/u-me`: `enabled_modules` includes `pos` ✓; sidebar shows POS link ✓
- `/pos/menu` styled correctly (1038+340 grid, dark `rgb(31,31,31)` tiles, sticky 340px side cart) ✓
- Cart-qty fix exercised end-to-end: add → decrement → remove via × → decrement-to-zero shows empty state ✓
- Submitted sale **S-00002** (Prod Smoke Customer, ₹11, instore) → backend auto-fulfilled (paid_at === fulfilled_at, payment_method=cash) ✓
- Audit log: 3 rows with `auto: true` on fulfill ✓
- **Bug found:** SaleDetailDrawer doesn't auto-refetch after state-button click. Reload fixes display. Backend correct. Pre-existing, NOT a regression.

### 2026-06-30 — Handoff doc created
- This file written at `docs/superpowers/handoffs/2026-06-30-pos-stack-shipped.md`
- Convention established: `<!-- OVERWRITE -->` sections rewrite, `<!-- APPEND -->` sections grow

### 2026-06-30 — POS v2 storefront shipped to prod
- Cherry-picked `feat/pos-v2-storefront-iso` (11 commits) onto main → `e52da02`
- Resolved one merge conflict in `MenuPage.tsx` (cart-qty `onQty/onRemove` + v2's `checkoutHref` prop combined)
- Tests: 821/821 (one flaky first run, clean second run — the intentional "throws outside provider" test logging its expected error)
- Applied migrations 043 (`clients_storefront_enabled`), 044 (`products_storefront_visible`), 045 (`sales_source` + nullable creator + CHECK) to prod (`dawn-bird`)
- Set `PUBLIC_BASE_URL=https://exsol.app` on prod context via `netlify env:set`
- Pushed `ab18c53..e52da02`; `feedback_netlify_new_function_404` trap fired (4 new functions); `restoreSiteDeploy` resolved
- All 4 public endpoints respond JSON: `/api/public/menu/:slug` (200 when storefront enabled / 404 `storefront_unavailable` when off), `/api/public/sales` POST (400 zod validation on empty body), `/api/public/sales/:uuid` GET (404 not_found), `/api/client-settings/storefront` GET/PATCH (401 unauthorized)
- **Note: path is `/api/client-settings/storefront` (slash), NOT `/api/client-settings-storefront` (hyphen)** — the sibling's prompt had this slightly off
- Booking migration collision flagged: Booking branch claims 043/044/045 with distinct filenames (`043_booking_core`, `044_bookings`, `045_booking_customer_phone_idx`) — runner keys by full filename so coexist on disk, but Booking SHOULD renumber to 046+ before its merge cycle for clarity
- End-to-end storefront UI smoke green: toggle on at `/c/papa-s-saloon/pos/settings` → guest browses `/menu/papa-s-saloon` → adds Egg 2 → cart page → details (Name+Phone+Pickup) → Place order → receipt at `/menu/papa-s-saloon/order/050e97fc-…` → DB shows `source='storefront'`, `created_by_user_node=null`, audit row with both actor IDs null
- **Known gap surfaced:** `exsol.app` DNS doesn't resolve — receipt URLs go nowhere until you configure DNS (or change env to the app domain)

### 2026-06-30 — Staff-side acceptance flow for storefront order S-00003 verified
- Walked the full receipt → list → detail → markPaid → fulfill chain on prod for S-00003 (the storefront/guest order)
- Channel-aware button label confirmed: pickup S-00003 shows `"Mark paid (cash)"` while instore S-00002 earlier today showed `"Mark paid (cash) & complete"` — the FE correctly reads `channel` to decide auto-fulfill messaging
- Pickup pathway needs **2 separate clicks** (markPaid → fulfill) vs instore's **1 click** (markPaid auto-fulfills). Audit log shows distinct `pos.sale.markPaid` and `pos.sale.fulfill` rows separated by 38s for pickup, vs same-timestamp for instore (with `detail.auto=true`)
- Audit trail attribution clean: guest-created row has both `actor_admin: null + actor_user_node: null + detail.source='storefront'`; staff transitions carry `actor_user_node` (Faraaz)
- **UI gap found:** the staff sales list does NOT visibly badge `source=storefront` rows. The column data is in the API row but no UI element surfaces it. Worth a small follow-up (5-line slice to add a `<StorefrontBadge>` next to order_no) — not blocking
- **SaleDetailDrawer auto-refetch gap re-confirmed:** still needs a one-line fix to re-fetch after state-button click. Reload works around it

---

## Suggested skills for the next agent <!-- OVERWRITE -->

- **`superpowers:using-superpowers`** — invoke at conversation start (always).
- **`superpowers:systematic-debugging`** — for any user-reported prod bug. The hash-triple diagnostic in `docs/architecture.html#traps` is the canonical Netlify-deploy debugger now.
- **`feature-dev:feature-dev`** — when POS v2 storefront FE work lands and needs main-chat integration.
- **`code-review:code-review`** — pre-push if a slice arrives that's larger than ~5 files or modifies any auth/perm code path. Catch perm-model integration gaps before they ship.
- **`verify`** — for any subsequent prod smoke. The Playwright + `browser_evaluate` pattern used today (fetch via the authed session inside the page context) is the cleanest pattern; direct curl probes can't validate FE gates.

### Session-specific guidance for the next pick-up
1. **If POS v2 storefront sibling chat says "ready to merge":** verify the 3 migrations (043–045) are additive in their headers, apply to prod first, then standard push + `restoreSiteDeploy` after deploy. The branch is `feat/pos-v2-storefront-iso` — check if it's branched off `69df370` (will need cherry-pick) or off current `ab18c53` (will FF clean).
2. **If a Netlify deploy "looks weird" post-push:** run the hash triple diagnostic before chasing anything else. See `docs/architecture.html#traps`.
3. **If a user reports POS UI is "broken":** the browser HTML cache trap is real. Have them run `document.querySelector('script[src*="/assets/"]').src` in console vs `curl -s https://prod/ | grep -oE 'index-[A-Za-z0-9]+\.js'` to confirm before debugging code.
4. **Update this file at every milestone.** Overwrite the top sections, append to the Milestone trail. The trail is the durable history.

---

## Reference artifacts <!-- OVERWRITE -->

- **Architecture doc:** `docs/architecture.html` (served at `http://localhost:9911/architecture.html` while Python http.server runs)
- **POS specs/plans:** `docs/superpowers/specs/2026-06-12-pos-module-design.md`, `docs/superpowers/plans/2026-06-12-pos-module-plan.md`
- **POS v2 storefront spec:** `docs/superpowers/specs/2026-06-29-pos-v2-storefront-design.md`
- **Booking spec:** check `docs/superpowers/specs/` for the locked spec from earlier this week
- **Memory entries used heavily today:**
  - `feedback_no_push_without_approval`
  - `feedback_migration_before_deploy`
  - `feedback_netlify_cache_clear` (hash triple)
  - `feedback_netlify_new_function_404`
  - `feedback_netlify_subdir_function_discovery` (added 2026-06-25)
  - `feedback_netlify_config_path_method` (added 2026-06-25)
  - `feedback_browser_html_cache_post_push`
  - `project_pos_v2_storefront`
- **Prod admin URL:** https://app.netlify.com/projects/exsoldatacollectionapp
- **Site ID:** `6d53c9bf-d6a7-4fb4-a16e-e5a4e94f59b4`
- **Dev Neon endpoint:** `ep-bold-wildflower-aoi9zvbd-pooler`
- **Prod Neon endpoint:** `ep-dawn-bird-aojs8xxb-pooler`
- **Active dev seed workspace:** `pos-test-5p9q5rc8` on dev DB (Owner: `pos-test-owner-pos-test-5p9q5rc8@exsol.test`, password redacted — see `tests/pos/_helpers.ts` `seedClientWithProductsEnabled()`)

---

## Don't do <!-- OVERWRITE -->

- Don't push without explicit user approval (binding, every push).
- Don't apply destructive migrations to prod without verifying the host (`echo $PROD_DB_URL | grep dawn-bird`) and the migration's idempotency.
- Don't trust integration tests to catch Netlify routing issues — they bypass routing. Pre-merge sanity grep: `grep -rE "^export const config" netlify/functions/ | grep -oE "(path: ['\"][^'\"]+['\"](, method: ['\"][^'\"]+['\"])?)" | sort | uniq -d` should be empty.
- Don't trust integration tests to catch styling issues — RTL doesn't load stylesheets. Visual smoke is non-redundant.
- Don't put a new function file in a subdirectory (`netlify/functions/foo/bar.ts`). Flat layout only. See `feedback_netlify_subdir_function_discovery`.
- Don't manually revoke the prior session's SQL grants on `papa-s-saloon` L1 (`pos.*` keys) without a clear reason — they're now redundant because of Phase 1 L1-bypass, but Faraaz is the real Owner and would want them anyway.

---

*End of handoff. Append milestones below as the session progresses.*
