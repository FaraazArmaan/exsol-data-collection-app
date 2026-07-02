# POS v1 stack complete + storefront staged — Handoff

**Last updated:** 2026-07-03 (live; appended at every milestone)
**Branch:** `main` (origin synced)
**Latest code deploy:** `9c9af2f fix(branding): professional redesign of the BrandingForm settings panel` · **HEAD (handoff docs on top):** `0be2d91` — origin synced, ahead 0, tree clean
**Prod URL:** https://exsoldatacollectionapp.netlify.app
**Test count:** **1085 passing** across 176 test files · typecheck + build clean (`u-products-image-thumb` DELETE test is FLAKY on the shared dev DB — passes in isolation; not a regression)
**Working tree:** clean (untracked: smoke artifact PNGs across all modules — `pos-menu-after.png`, `prod-pos-*.png`, `prod-storefront-*.png`, `prod-staff-*.png`, `prod-booking-*.png`, `prod-access-levels.png`, `prod-sidebar-new-links.png`, `prod-storefront-chrome.png`, `prod-file-manager.png`, `arch-*.png`, `exsol-arch-*.png`)

> **Convention for this file:**
> Sections marked `<!-- OVERWRITE -->` get rewritten on every milestone.
> Sections marked `<!-- APPEND -->` get new entries added underneath; existing entries are immutable.
> The "Milestone trail" is the durable session memory — never delete entries, only add.

---

## TL;DR for the next agent <!-- OVERWRITE -->

**SIX modules live on prod:** POS v1 (kiosk register), POS v2 (public storefront), Booking v1 (pay-at-venue), File Manager Phase B (quotas + bulk + redesign), Product Manager, and **Analytics (read-only cross-module, Sales domain)** — plus the L1-bypass + UX polish that made each usable. End-to-end prod smokes ran for all — kiosk sale S-00002, storefront sale S-00003, booking `e95ebfbd-…`, file-manager quota meter, analytics dashboard aggregating real POS sales. All `restoreSiteDeploy` rituals captured in `docs/architecture.html#traps` (hash triple + per-deploy URL probe). By 2026-07-01 the trap fires on EVERY bundle-hash-changing push — **10 consecutive `restoreSiteDeploy` invocations** across the run; a `bin/deploy.sh` wrapper is overdue.

**Systemic bug pattern crystallized:** every new module's `_<module>-authz.ts` + Sidebar/RouteMount gate ships strict-matrix-only and needs the L1 Owner bypass retro-fitted at merge time. Both POS Phase 1 (commit `ddb7ea4`) AND Booking (commit `b0a6fcd`) needed the same 3-file fix. New memory: [`feedback_module_l1_bypass_pattern`](../../../memory/feedback_module_l1_bypass_pattern.md). Worth a future refactor: extract `requireModulePermission()` in `_shared/permissions.ts` (queued for the Login+AMS sibling chat — paste-ready prompt drafted in this session).

**Most important next steps:**
1. **`exsol.app` DNS** — `PUBLIC_BASE_URL` env points there but DNS doesn't resolve. Storefront + booking receipts/manage links will dead-link until configured. Two paths: buy + alias the domain, or temporarily set env to the app domain. **This is an ops action item, not a chat task** — no code change once DNS lands.
2. ~~POS SaleDetailDrawer auto-refetch + Sales list storefront badge~~ — **SHIPPED** (`622cebd`, 2026-07-01). Storefront badge fully verified. Drawer refetch fixed (self-updates without reload) but with a serial-await latency caveat → follow-up optimistic-update enhancement queued (see open thread #17).
3. **`requireModulePermission()` refactor** — paste-ready prompt drafted for the Login+AMS sibling chat. Extracts the shared helper to `_shared/permissions.ts`; module-side migrations defer to individual module chats.
4. **Booking module access** — Owner can use it now (L1 bypass shipped). Access-levels UI correctly renders `Booking & Calendar — customers` + `— employees` matrix rows for L2+ delegation. No follow-up unless L2 staff workflows need verification.

**Closed earlier today:** storefront chrome CSS, StorefrontSettings sidebar link, dead `level_number:1` audit literal, permission validator defense-in-depth (all closed by the POS cleanup wave). Plus the booking smoke + L1 bypass fixes + the File Manager redesign + quotas.

---

## Current state on prod <!-- OVERWRITE -->

| Metric | Value |
|---|---|
| `origin/main` HEAD | `0be2d91` as of this update (handoff docs; last **code** deploy = `9c9af2f`). Handoff commits keep advancing this — trust `git log` / `git rev-list --count origin/main..HEAD`, not this cell. Origin fully synced. |
| Local `main` HEAD | = `origin/main`, ahead 0, tree clean (only untracked `.playwright-mcp/*` smoke artifacts) |
| Latest Netlify deploy | `ready` at commit `9c9af2f` (after `restoreSiteDeploy` — **21st consecutive**; new-function-404 AND/OR alias-not-promoted fire on EVERY push. STRONGLY consider a `bin/deploy.sh` wrapper: `git push → poll-ready → restoreSiteDeploy → verify-hash-triple`). Note: "no new functions → no restore needed" is a FALSE assumption a sibling made — alias-not-promoted is about the bundle hash, independent of functions; it fires on every JS/CSS-changing push regardless. |
| Migrations applied to prod (`dawn-bird`) | **001–050** (050 = `brand_columns`, 10 additive `brand_*` cols on `clients`, applied 2026-07-01 before code push) |
| **Domains live on prod** | **7**: POS v1 (kiosk), POS v2 (storefront), Booking v1 (pay-at-venue, day/week grid + reschedule + anti-abuse), File Manager Phase B, Product Manager, **Analytics (read-only cross-module, 5 domains, lazy-loaded, ZIP-CSV export)**, **Platform Branding (logos/hero/theme/fonts, 4 fns)** + AMS/Workspace foundation |
| New deps | `recharts ^3.9.1` (analytics, lazy chunk), `jszip` (analytics ZIP export), 14 `@fontsource*` (branding, WOFF2 subsets). All FE-bundled, NOT in external_node_modules. |
| **Functions registered** | **~98 total** — includes booking (20 + `booking-pending-cleanup` cron `*/5 * * * *`), File Manager (`files-quota`, `files-bulk`), Analytics (5: `analytics-{sales,overview,bookings,customers,team,catalog}`), Branding (4: `pub-brand`, `pub-brand-image`, `client-settings/brand`, `client-settings/brand-image`) |
| **POS v1 endpoints** | All reachable: `/api/pos/menu`, `/api/pos/sales` (GET+POST), `/api/pos/sales/:id`, `/api/pos/sales/:id/state` |
| **POS v2 storefront endpoints** | All reachable: `/api/public/menu/:slug`, `/api/public/sales` POST, `/api/public/sales/:uuid` GET, `/api/client-settings/storefront` GET/PATCH |
| **Booking endpoints** | 20 functions total; key paths verified live: `/api/booking-public/:slug/{services,resources,availability,create,manage}`, `/api/booking/{settings,services,resources,list,detail,manual-create,...}`, `/api/booking-razorpay-webhook` (stub) |
| **File Manager endpoints** | New today: `/api/files-quota` (GET/PATCH — usage + admin limit), `/api/files-bulk` (POST — delete/restore/tier/category). Plus existing Phase A endpoints (`/api/files`, `/api/files-detail`, `/api/files-download-url`, `/api/files-thumbnail`, `/api/files-upload`, `/api/files-upload-url`) |
| **CSS bundle** | `index-QX134iME.css` — 60 `.fm-*` rules (file manager) + 6 `.storefront-*` (POS v2 chrome) + the `.pos-*` kiosk register CSS + base theme |
| **PUBLIC_BASE_URL env (prod)** | `https://exsol.app` — **DNS not configured yet**, so receipt + manage links will be unreachable until domain is purchased/aliased OR env is changed to `https://exsoldatacollectionapp.netlify.app` |
| Prod sales on `papa-s-saloon` | S-00001 `d144307a-…` (staff, prior session) · S-00002 `f6ca9edc-…` (staff, today) · S-00003 `050e97fc-…` (storefront/guest, today) |
| **Prod bookings on `papa-s-saloon`** | 1 booking: `e95ebfbd-…` — anonymous guest, confirmed pay_at_venue, 09:00 IST 2026-07-01, Stylist A, manage_token `b3074721-…` |
| **`papa-s-saloon` storefront state** | **enabled** (toggled on during today's smoke at `/c/papa-s-saloon/pos/settings`) |
| **`papa-s-saloon` booking state** | **enabled** with Haircut service (30min, ₹500, pay_at_venue) + Stylist A resource + Mon–Sat 09:00–18:00 hours |
| **`papa-s-saloon` storage quota** | 5GB default (`5368709120` bytes) — backfilled by migration 046, currently 0 bytes used |
| **Sidebar inventory (Owner view)** | Dashboard · File Manager · Modules: Product Manager, POS, Booking, Orders, Payments · Workspace: Team, Storefront, Account — **10 links total, all live** |

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

1. **`exsol.app` DNS** *(ops — not a chat task)* — `PUBLIC_BASE_URL` is set to `https://exsol.app` on prod but the domain doesn't resolve. Receipt URLs in storefront + booking-manage links point to this unreachable host. Two paths: (a) buy the domain + add Netlify alias + cert; (b) change env to `https://exsoldatacollectionapp.netlify.app` for now. The functional flows work on the native app domain regardless of this. **Owner: Faraaz (DNS/billing), not a sibling chat.**

~~2. Storefront shell CSS missing~~ — **CLOSED** by POS cleanup wave (`4e6b6af` + `259a980`). 6 `.storefront-*` rules live on prod.

~~3. StorefrontSettings discoverability~~ — **CLOSED** by POS cleanup wave (`0714bcb`). Sidebar shows Storefront link in Workspace group.

~~4. Booking migration renumbering~~ — **CLOSED**. Renumbered to 047/048/049 + applied to prod earlier today.

5. ~~POS SaleDetailDrawer auto-refetch + Sales-list storefront badge~~ — **SHIPPED** `622cebd` (2026-07-01). Superseded by #17 below (the remaining optimistic-update enhancement).

~~17. POS drawer optimistic status update~~ — **SHIPPED** `fb13a87` (2026-07-01) + verified. The drawer pill now flips **3ms after the POST `/state` response** (measured on prod: POST done 2901ms, drawer-pill flip 2904ms, 2.5s BEFORE the refetch completes at 5424ms). Optimistic `setSale(s => ({...s, ...updated}))` fires right after the transition; refetch is best-effort backfill with `updated` still spread last (stale-refetch guarantee preserved). Sibling added a discriminating "held-open refetch" test that locks in the non-serialized behavior.
    - **CORRECTION to the earlier "6-8s" caveat:** that measurement was a MEASUREMENT ARTIFACT, not a real latency. The `/pos/sales/:id` route renders BOTH the sales list (6 row status-pills) AND the drawer (1 pill). `document.querySelector('.pos-pill')` grabbed pill #0 — a **list-row** pill, which updates via `onChanged → reload → getSales` (naturally ~list-refetch latency). The **drawer** pill (scope to `.pos-drawer .pos-pill`) always flipped at POST latency. Lesson: when a page has N instances of a class, scope the selector to the container. The `622cebd` fix DID gate the drawer pill behind the refetch; `fb13a87` fixed that — both real, but my prior "still slow" reading was of the wrong pill.

~~6. Hardcoded `level_number: 1` in POS audit~~ — **CLOSED** by POS cleanup wave (`2d07899`).

~~7. Permission validator vs `posProduct.requires: ['products']`~~ — **CLOSED** by POS cleanup wave (`2d07899` action validator hardening).

8. **Architecture doc** at `docs/architecture.html` — served at `http://localhost:9911/architecture.html` via a Python http.server. Includes §1.7 Customer-Facing URLs + §2.5 Booking Module Flow. **Should be updated** to reflect that POS v2 storefront is now live (move from "spec locked, building" to "live"). May add a Storefront-specific flow diagram.

9. **Booking module** — spec locked per session memory, building. Active on `feat/booking-module-iso`. Not yet on a worktree integrated to main.

10. **Sibling handoff conflict** — POS sibling chat also wrote `docs/superpowers/handoffs/2026-06-30-pos-session-handoff.md` (came in with the v2 cherry-pick). My handoff at `2026-06-30-pos-stack-shipped.md` (this file) and theirs cover overlapping ground. Worth reconciling next session — either merge into one or split by perspective (this one is mainframe-centric; theirs is POS-sibling-centric).

11. **Booking handoff doc** — `docs/superpowers/handoffs/2026-06-29-booking-module.md` came in with the booking cherry-pick. It's the sibling-chat-centric view of Phase 1+2 implementation. Not in conflict with this file (different scope: theirs is the booking-build narrative; this is the deploy-and-smoke narrative).

12. **`requireModulePermission()` refactor** *(Login+AMS sibling chat — paste-ready prompt drafted)* — extract shared helper to `_shared/permissions.ts` so per-module helpers don't redo bucket-user auth + level lookup + L1 bypass. Three modules have now shipped the same omission (POS Phase 1, Booking, plus File Manager Phase B kept the same strict-matrix pattern but happened to ship after the L1-bypass memory existed so caught earlier). Prompt explicitly says NOT to migrate the 3 existing module helpers in the same commit — let each module chat migrate at their own pace.

~~13. access-levels admin UI verified~~ — **DONE**. Booking + POS perms render correctly in matrix card; no code change needed for L2+ delegation.

14. **Future: chat-ownership map** — explicit mapping of which sibling chat owns which path-globs. Worth adding to this handoff or a sibling doc next session — would speed up dispatch when a new gap surfaces. Today's pattern: POS sibling owns `src/modules/pos/*` + `netlify/functions/pos-*` + `netlify/functions/pub-*`; Booking sibling owns `src/modules/booking/*` + `netlify/functions/booking-*`; Login+AMS owns `_shared/permissions.ts` + `src/modules/ams/*`; File Manager owns `src/modules/files/*` + `netlify/functions/files-*`; PM sibling owns `src/modules/products/*` + `netlify/functions/u-products*`. Main chat owns integration + deploys + handoff docs.

15. **File Manager Phase A — known follow-ups (sibling's ledger)** — `change_tier` and Phase-A `files-detail` PATCH insert `allowed_role_ids`/`allowed_node_ids`/`allowed_user_ids` without verifying those IDs belong to the caller's client. Not currently exploitable (visibility query never matches foreign IDs), but fix both together if those audience tables ever surface elsewhere.

16. **File Manager Phase C + D** — versions/folders (C), share links (D). Unbuilt. Will need migration numbers 050+.

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

### 2026-06-30 — Booking module shipped to prod (39 commits + 3 fixes)
- Cherry-picked all 39 commits from `feat/booking-module-iso` (off `69df370`) onto main; one conflict resolved in `router.tsx` (POS settings + booking routes coexist)
- **Renumbered migrations** 043/044/045 → **047/048/049** (POS-v2 took 043–045 earlier today; File Manager Phase B reserves 046; booking takes the next free block). `git mv` + in-file `-- NUMBERING:` comment updates. Splitter-safe (no inline `;-- ` comments).
- Reconciled dev DB by INSERT-ing 047/048/049 markers in dev's `schema_migrations` + DELETE-ing the old 043/044/045 booking markers (tables already existed under the old names; renumber is metadata-only).
- Applied 047–049 to prod (`dawn-bird`); btree_gist extension, 5 booking tables, `bookings_no_overlap` GIST exclusion, `user_nodes_client_phone_idx` partial index all verified.
- Pushed `e52da02..b0a6fcd` (43 commits in total — booking + renumber + 3 follow-up fixes); `feedback_netlify_new_function_404` trap fired (20 new functions); `restoreSiteDeploy` resolved. **The cron schedule `booking-pending-cleanup` (`*/5 * * * *`) registered cleanly via in-file `config.schedule` — first scheduled function in this repo, no `netlify.toml` additions needed.**

### 2026-06-30 — Three booking sibling-chat bugs caught at merge time
1. **Stale `useNavItems` tests** — sibling had added 'booking' to `MODULES_WITH_DEDICATED_NAV` (correctly excluding it from the generic Modules rail) but didn't update the 5 tests written against the pre-Phase-3b expectation. Updated tests to assert exclusion (matches POS + Products).
2. **FE gates missing L1 bypass** — `Sidebar.tsx` `showBooking` gate + `BookingRouteMounts.tsx` route gate both did strict matrix-only checks. Same omission as POS Phase 1 fix earlier today. Patched both with `isOwner ||` short-circuit + `enabledModules.booking` guard.
3. **BE authz missing L1 bypass** — `_booking-authz.ts` `requireBooking()` did strict matrix-only check. Mirrors `_pos-authz.requirePos`. Patched: LEFT JOIN client_levels (so missing rows resolve to null perms instead of dropping the user), resolve `level_number` from `un.level_number`, short-circuit L1 with full `ALL_BOOKING_PERMS` set in ctx. Updated 4 strict-403 tests to use a new `demoteToL2()` helper that creates a fresh L2 subordinate (not in-place demotion — that would violate `user_nodes_parent_level_consistency` constraint).
- New memory entry: [`feedback_module_l1_bypass_pattern`](../../../memory/feedback_module_l1_bypass_pattern.md) — this is now the 2nd module to ship the same omission; pattern is systemic.

### 2026-06-30 — End-to-end booking smoke green on prod
- Owner reached vendor settings at `/c/papa-s-saloon/booking/settings` (post L1-bypass push); set Mon–Sat 09:00–18:00 schedule
- Created Haircut service (30min, ₹500, `payment_mode: pay_at_venue`) + Stylist A resource via the vendor API
- Anonymous guest visited `/c/papa-s-saloon/book` → service picker → date picker (defaulted today which was past hours; picked 2026-07-01) → 18 slots rendered (9:00–17:30, 30-min) → picked 10:00 → entered Name + Phone + terms checkbox → Confirm booking
- Confirmation page shows: "✓ You're booked!", Copy link, Add to calendar (.ics), Manage booking (token URL `/c/papa-s-saloon/book/manage/<manage_token>`), Book another
- DB verified: `bookings.id=e95ebfbd-…`, `status=confirmed` (pay_at_venue auto-confirms), `time_range='[2026-07-01 04:30:00+00, 2026-07-01 05:00:00+00)'` (= 10:00 IST), `customer_name="Booking Smoke Guest"`, `customer_phone="+919876543200"`, `created_by_user_node=NULL` (guest), `user_node_id=cb343def-…` (auto-created via match-or-create), `manage_token=b3074721-…`, `price_cents=50000`
- Access-levels admin UI verified: `Booking & Calendar — customers` + `Booking & Calendar — employees` rows render in the L2 matrix card with View/Create/Edit/Delete toggles, alongside Payments, Product Manager, Platform, POS sections

### 2026-06-30 — POS cleanup wave (8 sibling commits + 1 test-fix)
- Cherry-picked 8 follow-up commits from `feat/pos-action-perms-iso`, `feat/pos-stylesheet-iso`, `fix/pos-cart-qty-iso`, `feat/pos-v2-storefront-iso`. Each commit was the sibling's targeted fix for a real gap surfaced by the earlier prod smoke (storefront chrome plain, no Storefront sidebar link, no Orders sidebar link, dead `level_number:1` audit literal, validator defense-in-depth)
- Conflicts: 1 (Sidebar.tsx — both Booking link from booking merge and Orders link from this wave want the same insertion point; kept both)
- 1 follow-up test fix: `storefront-nav.test.tsx` didn't seed `enabledModules.pos` so the new "Orders link" tests failed at the `posEnabled` gate added during POS Phase 1
- Pushed `b0a6fcd..0d3d842` (9 commits including the test fix). Alias-not-promoted trap fired again (4th time today — pattern: any JSX-shape-changing push trips it). `restoreSiteDeploy` resolved
- Verified live: prod CSS bundle has 6 `.storefront-*` rules; `/menu/papa-s-saloon` shows the centered dark shell with 1040px max-width main and bordered header; workspace sidebar as Owner shows new Orders + Storefront links; `SideCartPanel` qty controls now optional (merge-safe for v2 storefront callers); audit no longer hardcodes `level_number:1`
- Closed 4 open threads: storefront chrome CSS missing, StorefrontSettings discoverability, dead audit literal, validator defense-in-depth

### 2026-06-30 — File Manager Phase B shipped to prod (5th module of the day)
- Cherry-picked 12 commits from `feat/file-manager-phase-b-iso` (HEAD `3763323`) onto current main (`0d3d842`) — clean, **zero conflicts** despite branching from `ab18c53` (start of session, 41 commits ago)
- 31 net-new tests (917 → 948). Typecheck + build clean
- Migration **046_workspace_storage_quota** applied to prod (`dawn-bird`) — the slot we reserved at the start of the day when renumbering Booking. Sibling's handoff item #1 (043-045 collision) was already done by my earlier session work
- Pushed `0d3d842..3763323` (12 commits). new-function-404 trap fired (2 new endpoints: `files-quota`, `files-bulk`). `restoreSiteDeploy` resolved. Both respond JSON 401 (auth gate intact)
- CSS bundle (`index-QX134iME.css`) has **60 `.fm-*` selectors** — full UI redesign live. `/c/papa-s-saloon/file-manager` renders with `.fm` root (1180px), QuotaMeter showing "0.0 GB / 5.0 GB · 0%", 4-option sort (Newest/Oldest/Name A-Z/Largest first), 9 categories
- API truth: `/api/files-quota` → `{ byte_limit: 5368709120 (=5GB), bytes_used: 0 }`. Backfill of migration 046 set 5GB default for all clients
- Other new pieces: `files-bulk.ts` (soft_delete/restore/change_tier/add_category/remove_category with out-of-scope ids skipped), lazy WebP thumbnails via sharp, QuotaMeter + BulkActionBar + search/sort UI

### 2026-06-30 — No-op merge round: stale POS sibling handoff (3rd today)
- POS sibling chat sent a "merge these branches" handoff naming `feat/pos-action-perms-iso 2d07899`, `feat/pos-stylesheet-iso 639af6b`, `fix/pos-cart-qty-iso 78f8f53`, `feat/pos-v2-storefront-iso 536f1a0` as final HEADs
- Verified all 4 in 30s via `git merge-base --is-ancestor` — content of every commit except `639af6b` (v3 light theme preview) already on main via earlier cherry-picks
- `639af6b` is the v3 branding preview the user explicitly directed to **exclude** pending AMS-chat rework (ADR 0001). Sibling called it "harmless to include" but that's the kind of dead-code-left-behind problem the user wants to avoid. **Skipped per user directive.**
- Sibling's "Do not run migration 046" note is moot — 046 was used today by File Manager Phase B (workspace_storage_quota). If pos-v3-branding-iso reserved 046, AMS will need to renumber to 050+ at merge time
- Drafted a "status correction" paste-ready note for the sibling so they re-anchor their next handoff to current main (`3763323`, not the start-of-session SHAs they keep using)
- **No commits added; no push.** Today's session is wrapped on the merge front.

### 2026-06-30 — Session-end inventory (5 modules + 3 polish waves)
- Modules live on prod this session: **POS v1 (kiosk register)**, **POS v2 (public storefront)**, **Booking v1 (pay-at-venue)**, **File Manager Phase B (quotas + bulk + redesign)** + the foundational fixes that made all of them actually usable by Owners
- Polish waves: (1) POS Phase 1+2 (L1 access + L2 delegation UI + CSS), (2) POS cleanup wave (sidebar links + chrome CSS + cleanups), (3) Booking L1-bypass triple-fix (Sidebar + RouteMounts + authz)
- Deploy traps observed today: `new-function-404` fired **5 times**; `alias-not-promoted` fired **4 times**. All resolved via `restoreSiteDeploy` (the diagnostic procedure now in `docs/architecture.html#traps` is reliable)
- Tests: 821 (morning) → 948 (now). +127 net tests across 35+ new test files

### 2026-07-01 — AMS workspace backup card polish (clean FF)
- FF-merged `feat/ams-workspace-backup-ui-iso` (`5999c29`, 1 commit off my `3763323` — a TRUE `--ff-only`, first frictionless merge of the run because the branch was cut from current main, not a stale SHA)
- Fixes the white-on-dark slab bug: `.ams-export-card` referenced non-existent `--color-*` CSS vars → silently fell back to defaults (white). Renamed to the real token family (`--bg-surface` / `--border-default` / `--text-primary` / `--text-secondary` / `--danger`). CSS doesn't error on undefined custom props, so there was no compile signal — only visual/CSSOM detection.
- Relocated the workspace backup card `/c/:slug/team` → `/c/:slug/account`; added `AdminWorkspaceExportCard` on `/clients/:clientId` (admin sees the same affordance, calls `/api/workspace-export?client=<id>`)
- Tests 948 → 953. Pushed `3763323..5999c29`; alias-not-promoted trap (5th) → `restoreSiteDeploy`
- 4-step smoke green: (1) `/account` card dark-themed at bottom; (2) `/team` no longer shows it; (3) admin `/clients/<id>` card after Products section, dark theme; (4) download URL = `/api/workspace-export?format=json&client=<id>`, file saved with client slug
- **Note:** sibling's "53 typecheck errors on origin/main" claim was a FALSE ALARM — stale worktree with missing deps. My main was clean at both `3763323` and `5999c29`. Same class as the earlier zustand-missing trap; siblings must `npm install` before reporting error counts.

### 2026-07-01 — POS UX fixes (SaleDetailDrawer refetch + storefront badge)
- Cherry-picked `74e6b0f → 622cebd` (base `3763323`, so cherry-pick not FF). Tests 953 → 956. Pushed `5999c29..622cebd`; alias-not-promoted (6th) → `restoreSiteDeploy`
- **Fix 2 (storefront badge): fully verified on prod.** `SalesListPage` renders a muted `pos-pill pill-gray` "Storefront" pill when `sale.source === 'storefront'`. Verified S-00003 (storefront) shows it; S-00001/2 (pos) don't. Keys off `source` (migration-045 field), not channel.
- **Fix 1 (drawer status): correctness verified, but a UX caveat found.** The reported bug ("pill stays stale until manual reload") IS fixed — verified across 4 fresh test sales (S-00004–S-00007), all self-updated to Paid without reload. The code (`SaleDetailDrawer.tsx:37`) does `setSale({ ...detail, ...updated })`, spreading the authoritative POST `/state` response last so it wins over a stale/failed refetch. Unit tests cover the stale-refetch + refetch-reject cases.
- **UX caveat (follow-up, NOT a blocker):** `setSale` is gated behind BOTH the POST `/state` await AND the best-effort refetch await, serially. MutationObserver + fetch-instrumentation on prod measured: POST returned at 2854ms (authoritative status known here), refetch at 5402ms, pill flipped only at ~6-8s. On cold Netlify functions the serial awaits stack up. A cleaner fix: `setSale(s => ({...s, ...updated}))` immediately after the transition (instant optimistic flip), THEN backfill lines/audit from the refetch. Follow-up prompt drafted for the POS sibling chat.
- **Smoke artifact:** created 4 test sales (S-00004–S-00007) on papa-s-saloon; POS has no hard-delete (cancel/refund only), so they persist as evidence rows. Workspace now has 7 sales, 4 of them test artifacts.

### 2026-07-01 — POS drawer optimistic update (shipped + verified) + measurement-artifact correction
- Cherry-picked `496c7f7 → fb13a87`. Tests 956 → 957 (incl. the sibling's discriminating "held-open refetch" test). Pushed `e3ccb73..fb13a87`; alias-not-promoted (8th) → `restoreSiteDeploy`
- **Verified with hard numbers on prod:** the drawer pill flips **3ms after the POST `/state` response** (POST done 2901ms, drawer-pill flip 2904ms, 2.5s BEFORE the refetch at 5424ms). Optimistic `setSale(s=>({...s,...updated}))` fires right after the transition; refetch is best-effort backfill.
- **CORRECTED the prior "6-8s" caveat — it was a MEASUREMENT ARTIFACT.** The `/pos/sales/:id` route renders BOTH the sales list (6 row status-pills) AND the drawer (1 pill). `querySelector('.pos-pill')` was grabbing pill #0 (a LIST-ROW pill, which updates via `onChanged→reload→getSales` at ~list-refetch latency). Scoping to `.pos-drawer .pos-pill` showed the drawer pill always flipped at POST latency. LESSON: when a page has N instances of a class, scope the selector to the container.
- Created 3 more test sales (S-00008–S-00010) during instrumentation. papa-s-saloon now has 10 sales, 8 of them smoke artifacts (no POS hard-delete). Candidate for a dev-only workspace teardown.

### 2026-07-01 — Booking vendor sub-nav tabs (stale handoff, 1 real commit)
- The "take Booking to production" handoff was STALE (Booking shipped 2026-06-30: migs 047-049 applied, module live). Only genuinely-new commit: `7525dd1 → e3ccb73` — `BookingTabs` sub-nav (Calendar/Bookings/Services/Resources/Settings) across vendor pages, closing the nav gap where config pages were URL-only.
- Verified on prod: 5 tabs render + navigate; Services shows Haircut, Resources shows Stylist A, Settings shows slot interval + weekly hours. Tests unchanged at 956 (nav component, no tests added).
- **Nit for the sibling:** the sidebar "Booking" NavLink lacks `end`, so it stays visually active on all `/booking/*` sub-routes, competing with the BookingTabs active state. One-word fix (`end`). Non-blocking.

### 2026-07-01 — Booking card-button text fix (CSS-only)
- Cherry-picked `1d8b8cb → 1670dd6` (2-line CSS). `<button class="card">` (day-view booking cards + storefront service cards) reset to UA-default black text because `.card` sets no `color` and there's no global `button { color: inherit }`. Added `color: var(--text-primary); font: inherit;` to `.booking-cal-card` + `.booking-service-card`.
- Verified live: `.booking-service-card` computed `color: rgb(236,232,223)` (cream, not `rgb(0,0,0)`). alias-not-promoted (9th) → `restoreSiteDeploy`.
- **3rd instance this run of the "styled `<button>` resets `color`/`font` to UA defaults" bug** (prior: AMS white-slab, and the `--color-*` typo family). RECOMMENDATION for the design/AMS sibling: add a global `button { color: inherit; font: inherit; }` to the base stylesheet to prevent this class entirely.

### 2026-07-01 — Analytics Module shipped to prod (6th module, first read-only cross-module)
- Cherry-picked 14 commits `f6c921e..18d0a98 → e7735b0` (branch was off `f6c921e`, ~30 commits behind current main). **1 conflict in `Sidebar.tsx`** — resolved additively (POS Orders + Storefront gates AND analytics gates coexist). router/useNavItems/registry auto-merged.
- New dep **recharts ^3.9.1** — `npm install` (FE/vite-bundled, deliberately NOT in `external_node_modules`). Tests 957 → **1001** (+44 analytics). Typecheck + build clean.
- Pushed `1670dd6..e7735b0`; new-function-404 on all 3 endpoints (`analytics-sales`, `analytics-overview`, `analytics-sales-export`) → `restoreSiteDeploy` (10th) → all 401 JSON.
- **Operational step (REQUIRED for visibility):** Analytics is a Product — enabled `client_enabled_products` row `product_key='analytics'` for papa-s-saloon. L1 Owner is all-on (no explicit grant needed).
- Dashboard smoke green: `enabled_modules` includes `analytics`, sidebar Analytics link present, `/c/papa-s-saloon/analytics` renders KPI tiles (Revenue ₹7 / Sales 7 / AOV ₹1 — aggregating the real POS sales) + **136 recharts elements** (trend/bar/donut) + Sales panel, no errors. `analytics-sales` API returns `{scope, kpis, series, breakdowns, generatedAt}`.
- **Sibling got ALL prior-lesson traps right inline** (unlike POS/Booking which needed retro-fits): both Module + Product manifest (`feedback_module_needs_product_manifest`), bucket×verb perms (`feedback_permission_keys_bucket_verb_only`), `MODULES_WITH_DEDICATED_NAV` entry, L1-bypass in authz + FE gates. Evidence the memory entries + arch docs are being consumed cross-chat.
- **Deferred (all non-blocking, per sibling):** recharts bundle >500kB (lazy-load the route later); currency hardcoded INR; date presets compute in UTC not tenant-tz (IST post-18:30 → tomorrow, cosmetic); `analytics-overview` built+tested but not surfaced (Sales panel only); follow-on domains (Bookings/Customers/Team/Catalog) each add an endpoint + manifest + panel reusing `resolveAnalyticsAccess` + `_analytics-sql`.

### 2026-07-01 — Docs merge (POS v2.5 spec + living trails + architecture) pushed
- Cherry-picked 2 POS docs-only commits (`fae9fff` v2.5 Razorpay online-payment design spec, `0d67e55` POS session living-trail refresh) → `f626dac`, `998ad75`.
- Committed 2 previously-uncommitted docs: this handoff trail (`2a8e62a`) and the architecture pair (`4e8dda3` — `architecture.html` suite framing + 13 ERP modules; `architecture-expansive.html` was **untracked, 1395 lines** — nearly lost). All 4 docs commits pushed `e7735b0..4e8dda3`; restoreSiteDeploy (11th).
- **v2.5 migration-number coordination:** spec assumes migration **051**, but main's highest is **049** and branding's (unmerged) work claims **050**. So 051 is correct ONLY if branding lands first. Confirm next-free when v2.5 is actually built (design-only until Razorpay keys). New env var at build time: `RAZORPAY_ENC_KEY` (base64 of 32 bytes) in every Netlify context.

### 2026-07-01 — Booking FE polish delta (3 commits, all frontend)
- Cherry-picked **3** of 4 handed-off commits: `52366de` (vendor config UI), `c27f633` (time-grid calendar), `7e4bc5e` (storefront redesign) → on main as `18dd0c4`, `0e237db`, `b64cedd`. **Skipped `1d8b8cb`** — already on main as `1670dd6` (the sibling flagged the possible dup; confirmed via `git cherry` patch-equivalence). Running their literal `cherry-pick 1d8b8cb …` would have halted on an empty commit.
- FE-only, no migrations/functions/tests. Tests held at **1001**. alias-not-promoted (12th) → `restoreSiteDeploy`.
- **All 4 features smoke-verified on prod:** (1) storefront redesign — `.booking-sf-steps` stepper (Service→Time→Details), centered 520px column (left gap 496 = right 496); (2) time-grid calendar — `booking-grid` with 09:00–18:00 hour gutter, resource columns, 11 status-colored positioned blocks incl. a `block-confirmed` at 10:00; (3) ServiceEditDrawer (Name/Duration/Price/Buffer/stylist); (4) Resources per-resource working-hours (14 time inputs, "blank = inherit venue hours"); (5) Settings "Closed dates (holidays)" section.
- **SHA reconciliation note for the Booking sibling:** their branch tip `7e4bc5e` is on main as `b64cedd` (cherry-pick re-parents the SHA). Next handoff, all 4 of their commits will read as "already applied" via `git cherry` even though no SHAs match.
- **Coverage-gap flag (recurring):** these 3 commits add a new drawer + a pixel time-grid with click-to-create + a full storefront relayout, all with ZERO added tests. Booking component-test coverage is lagging its feature growth (same note as the sub-nav-tabs merge).
- **Still owed for a full prod cut** (unchanged): live Razorpay order-create + `ONLINE_PAYMENTS_ENABLED=true` flip (blocked on keys), an email provider for confirmations, confirm `booking-pending-cleanup` cron registers.

### 2026-07-01 — Analytics polish + full-domain round (styled dashboard + 4 domains + lazy-load)
- Cherry-picked `7a73964, 34d14ce → 4457065, d9817c9`. Tests 1001 → **1009**. 4 new endpoints (`analytics-bookings/customers/team/catalog`) → new-function-404 → `restoreSiteDeploy` (14th).
- Fixed the previously-**unstyled** dashboard (added `analytics.css`), added Overview scorecard + data-driven multi-domain dashboard, **lazy-loaded** the analytics route (recharts code-split into a 418kB on-demand chunk).
- Smoke: all 5 domain endpoints 200, `analytics.css` chunk loaded, **amber bars/lines `#c9a26a`** + themed donut palette (mauve/amber/terracotta). NOTE the wrong-element trap: `querySelector('.recharts-bar-rectangle path')` returned a black *background* rect; enumerate-all-fills showed real bars are amber.

### 2026-07-01 — Booking full delta (6 new commits, backend + tests)
- **Reflog rescue:** the 6 commits (`fc8782e, 6a64a62, 7ddb80a, 679164c, 88c83f7, aaefd1f`) were ALREADY applied in a compacted-away segment (`9366de1..ba1f8c4`). My re-attempt this turn conflicted on already-present content; `--abort` preserved the good commits. **Reflog is ground truth** when your model of HEAD disagrees with git — immune to context compaction. Do NOT resolve a confusing conflict; abort and investigate.
- Storefront flow polish + mobile, readable calendar blocks, anti-abuse (honeypot + fail-open IP rate-limit via `booking-ratelimit` Blobs store), business name/avatar header, reschedule (vendor + customer magic-link), Day/Week calendar toggle. Tests 1009 → **1014**. alias trap (14th) → restore. `_booking-ratelimit.ts` is underscore-prefixed = silent helper, NOT a new endpoint (no 404 risk).
- Smoke: **honeypot A/B** (`hp` filled → 400 `invalid_request`; empty → 201 created — check order is parse→honeypot→ratelimit); manage endpoint at `/api/booking-public/manage/:token` (NO `:slug`); business-name/avatar header; 7-column Week view. Cancelled the honeypot-control test booking via its manage token.

### 2026-07-01 — Analytics panel-gating + polish (the dead-panel fix)
- Cherry-picked `da66be4, 2106d2f → 21bf97d`. Tests 1014 → **1021**. Modified `analytics-overview.ts` (existing fn, no new endpoint). alias trap (16th) → `restoreSiteDeploy` — sibling's "no restore needed (no new fn)" was WRONG; alias-not-promoted is bundle-hash-driven, function-independent.
- Fix: Bookings/Catalog panels + scorecard gated on `enabledModules` (mirrors Sidebar's `enabledModules.some(m=>m.key===…)`). I wrote the handoff prompt → routed to **Analytics chat** (analytics-owned files, not Booking).
- **Gating verified both directions** via a reversible DB toggle on papa-s-saloon (capture-row → delete → verify → re-insert identical row → verify restored): booking ON → 5 panels incl. Bookings; booking OFF → 4 panels, Bookings gone, Catalog stays (products still on); restored → Bookings back. papa-s-saloon left in its exact prior state.
- Compare-deltas: overview returns `delta`/`deltaPct`; `deltaPct: null` on zero baseline (correct — no misleading "+∞%").
- ~~⚠️ CSV export bug~~ — **FIXED** `43b59c6` (2026-07-01, see milestone below). The per-domain "Export" click revoked the blob object-URL synchronously after `click()`, so Chromium wrote an untyped, UUID-named, unopenable file. My smoke passed on "download fired" — but the **CSV content was not functional** (user caught it). LESSON: "a download triggered" ≠ "the file is valid"; parse/validate exported content, not just confirm the blob downloaded.

### 2026-07-01 — Platform Branding domain merged to prod (migration 050 + 4 fns + 14 fonts)
- **`--no-ff` merge** `feat/platform-branding-iso → 888f09b` (26 commits off a stale `3763323`). Chose merge over cherry-pick because the branch had **npm dependency churn** — cherry-picking 26 commits would conflict on `package-lock.json` repeatedly; a single 3-way merge auto-resolved package.json/lock cleanly (branding's `@fontsource*` keys vs main's `recharts` are disjoint). **Heuristic: dependency-churn branch off a stale base → merge-once, not cherry-pick-many.**
- **3 conflicts, all additive "two siblings added a card to the same anchor"** — `components.css` (union both blocks), `AccessDashboard.tsx` + `UserAccount.tsx` (kept BOTH my workspace-export card AND the branding card). Verified live: `/account` shows "Workspace backup" AND "Branding". Union-both is the correct resolution for additive-at-same-anchor; picking a side would silently drop a team's card.
- **Migration 050** (`brand_columns`, 10 additive `brand_*` cols) applied to prod (`dawn-bird` verified) **before** the code push — additive-before-code is the safe order (columns sit unused until code reads them; inverse of destructive). Tests 1021 → **1084** (+63). 14 fonts (5 `@fontsource` + 9 `@fontsource-variable`), WOFF2 subsets emitted, `external_node_modules` unchanged.
- **4 new functions**, all registered after `restoreSiteDeploy` (17th): `pub-brand` (GET `/api/public/brand/:slug` → 200 JSON), `pub-brand-image` (GET `/api/public/brand/:slug/image/*`), `client-settings/brand` (PATCH, `.strict()` camelCase schema — `fontHeading` not `font_heading`), `client-settings/brand-image` (POST multipart). NOTE the authed paths use `/client-settings/brand` (slash), not `-brand` (hyphen).
- **Persistence verified end-to-end:** PATCH theme=light/accent=#c9a26a/fontHeading=Poppins → reflected in the brand read; reverted → **DB pristine** (dark/nulls). ⚠️ `pub-brand` is **cached `max-age=86400`** — read-after-write on the public endpoint serves stale for up to 24h; verify writes against the DB or an authed read, not the cached public endpoint. Consume-contract note for Branding chat: if instant brand updates are needed, add a cache-bust on save.
- **Handback READY for POS (§9.4) + Booking (§9.5) chats** (BrandShell/BrandHero/useBrand barrel at `src/modules/branding`): both must wrap public pages in BrandShell, drop their own `.page-narrow`/checkout-narrowing in favor of `.brand-main`, and read slug appropriately. v1.1 follow-ups (hero drag-reorder, useBrand auto-refetch, SSR OG-meta) are non-blocking.
- Probe false-alarms this round (all my test errors, zero real bugs): hyphen-vs-slash path (404), no-logo `not_found` JSON vs unregistered HTML 404, snake_case vs `.strict()` camelCase (400). **Read the contract before concluding "broken."**

### 2026-07-01 — Two hotfixes deployed + smoked sequentially (analytics CSV export + booking week grid)
- **Analytics CSV export FIX** (`12e29f3 → 43b59c6`): the export revoked the blob object-URL synchronously after `click()` → Chromium wrote an untyped UUID-named unopenable file. Fix zips via **JSZip** (already a dep; lands in the lazy analytics chunk → 517kB, main bundle unchanged) + defers the revoke. Now downloads `<domain>-<date>.zip` → `<domain>-<date>.csv`. **Content-validated on prod** (the correction of my earlier miss): captured the blob → ZIP magic bytes `50 4b 03 04` → unzipped → CSV has real rows (Revenue 29.00, Sales 10, channel/category breakdowns). alias trap (19th) → restore.
- **Booking week-view time-grid** (`d7b1184 → 0c63f2b`): rewrote the vendor week view from an agenda list to a Google-Calendar-style time grid (gutter + 7 day-columns + hour lines + time-positioned events with lane-packing), unifying day+week on one grid engine. FE-only (CalendarPage.tsx + append-only CSS). Resolved the `components.css` conflict by union (branding block + new `.booking-week-head` CSS). Smoke: Week = 7 `.booking-week-head` cols + 10 hour labels + 11 positioned blocks, old `.booking-week-col` agenda GONE; day-header click → Day view. alias trap (20th) → restore.
- **Process note:** I chained `npm test && git push` on the analytics hotfix and only saw the (flaky `u-products-image-thumb`) failure AFTER pushing. Given the shared-dev-DB flakiness, run the suite as its OWN step and eyeball it BEFORE pushing, so a real regression can't slip out unseen. Harmless here (flake, FE-only change), but don't chain test→push.
- **Content-validation rule (now proven twice):** for any file-producing feature, verify the produced BYTES (magic bytes → unzip → read rows), never just that a download was triggered. "Download fired" passed while the file was broken last round.

### 2026-07-01 — BrandingForm settings panel redesign (FE-only, `9c9af2f`)
- Redesigned the branding settings UI that shipped raw in v1 (`888f09b`). Two files: `BrandingForm.tsx` (+280/−66) + `components.css` (+123). No migration, no function, no dep change. Tests held at **1085** (the 20 branding FE tests stay green — all accessible names/aria-labels preserved through the rework).
- **Real bug fixed: "Choose file doesn't open."** The v1 inline `<label>`-wraps-`<input type=file>` markup didn't reliably trigger the OS picker. Replaced with custom upload tiles that drive a **hidden ref'd `<input>` via button/keydown handler** — the reliable cross-browser pattern for styled file pickers. Tiles add a transparency-checkerboard preview, drag-and-drop, live object-URL preview after pick, and a hover "remove".
- Other polish: 5-tile logo grid (Primary/Alternate/Favicon/App icon/Social) with dimension hints; hero dropzone + thumbnail strip; accent color picker (native swatch + `#`-hex field + "Suggest from logo" surfacing `suggestAccentFromLogo`); segmented Dark|Light theme control with preview dots (v1's raw radio fieldset rendered broken); typography selects grouped by optgroup with a live font-preview line; uppercase section labels on the warm-dark token palette.
- **Deploy:** already pushed + synced (`origin/main` = local = `9c9af2f`); Netlify `ready` after the **21st consecutive `restoreSiteDeploy`** (CSS+JS bundle-hash changed → alias-not-promoted, as predicted). Visually verified via screenshot.
- **Still owed (unchanged from branding merge):** `pub-brand` is cached `max-age=86400`, so public read-after-write is stale ≤24h — add a cache-bust on save if instant brand updates are wanted. POS (§9.4) + Booking (§9.5) chats still need to wrap their public pages in `BrandShell`/`.brand-main`.

### 2026-07-03 — Branding settings UI redesign + file-picker bugfix
- Cherry-picked `0685764 → 9c9af2f` (follow-up to the already-deployed platform-branding feature). 2 files (BrandingForm.tsx rewritten + `components.css` `.brand-*` block). No backend/migration/deps/endpoints. Tests 1085/1085 (20 branding FE tests green, aria-labels + headings preserved). alias trap (21st) → `restoreSiteDeploy`.
- **The fix:** native file inputs were nested in `<label>` and mangled by the **global `label` flex rule** (same "broad global CSS rule breaks a specific element" class as the white-slab `--color-*` typo and `<button class="card">` — 3rd variant this run; the base stylesheet's blanket `label`/`button` rules are a recurring liability worth an audit). Replaced with hidden ref-driven `<input>` triggered by `.click()`. Plus a full settings-panel redesign (logo tile grid + previews + drag-drop, hero dropzone, real accent color picker, segmented Dark|Light, grouped font selects).
- **CONFLICT resolution note (non-trivial):** `components.css` conflict was NOT a simple union. HEAD intermingled orphaned OLD brand rules (`.brand-upload-slot`/`.brand-swatch` — drop, superseded by the rewrite) with `.booking-week-head` week-grid CSS (KEEP — landed on main after the branding branch forked). Verified by grepping the new component (uses `.brand-swatch-btn`, defined in the new block; 0 refs to the old classes) before dropping. LESSON: when one conflict side is a rewrite and the other has unrelated additions, read the CONSUMING code — don't pick a side.
- **Smoke proven end-to-end on prod:** 6 file inputs all hidden/ref-driven, **0 label-wrapped inputs** (buggy pattern gone); clicking a logo tile fires its hidden input's `.click()` (`accept=image/*`) — verified by intercepting `HTMLInputElement.prototype.click` so the OS dialog stayed closed while proving the wiring reaches it. The last millimeter (OS dialog visibly opens) is the one thing left to human eyes; sibling's pre-commit screenshot covered it.
- The previously-unpushed handoff commit `dc06c3c` rode along in this push — origin handoff now current.

### 2026-07-03 — State-review session (no code change) + handoff pointer sync
- Fresh session picked up, read this handoff end-to-end, reconciled it against live git. **No code touched, no tests run, no deploy.**
- **Correction to the last startup snapshot:** it described `27bca23` as local-only (ahead of origin by 1, unpushed). Reality at pickup: `27bca23` AND `0be2d91` are both on `origin/main`; local = origin = `0be2d91`, ahead 0, tree clean (only the usual untracked `.playwright-mcp/*` smoke artifacts). Those handoff commits were pushed between sessions — **trust `git log` / `git rev-list --count origin/main..HEAD` over any prose snapshot.**
- Refreshed the HEAD-pointer cells in "Current state on prod" so the next agent doesn't hit the same "snapshot disagrees with git" confusion.
- **Nothing on fire:** all 7 domains verified on prod last session, 1085 tests green (1 known dev-DB flake `u-products-image-thumb`), migs 001–050 applied. Highest-leverage *main-chat-owned* open code item = architecture-doc status bump (#8, POS v2 storefront still framed "building" but it's live); the `requireModulePermission()` refactor (#12) is routed to the Login+AMS sibling chat, not this one.

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
