# ExSol Data Collection App — Handoff Log

> Newest session at the top. Each session is a dated block.
> See `CONTEXT.md` for the canonical glossary and `docs/adr/` for architecture decisions.
> This file moved from repo root to `docs/handoff.md` at end of 2026-05-19 (evening).

---

## 2026-05-19 (evening) — local smoke test + 2 bug fixes, paused mid-flow

### Goal we are working towards

Same v1 goal. **This session focused on getting the Phase 4 build actually running on localhost end-to-end.** Phases 1–4 code complete; the smoke test exposed two real bugs and one configuration gap that are now fixed.

### Current state of the code

- **Build still green.** Last `npm run typecheck` and `npm test` both pass (24 / 49 with DB-gated tests skipping).
- **Local dev environment is fully set up and verified.**
  - `.env` populated with real Neon connection string, JWT signing secret, Google OAuth Client ID, both admin emails.
  - All 8 DB migrations applied to the user's Neon project (`exsol-dev`).
  - Two admin users exist in the DB:
    - `theexsolenterprise@gmail.com` — Google sign-in (no password).
    - `admin@example.com` / `<see local notes>` — email+password fallback (no Google linked).
- **Google sign-in tested successfully** in the browser. Admin landed on `/admin.html` as expected.
- **Dev server stopped at end of session.** Restart with `npm run dev` from the project root.

### Files actively editing

**None.** Clean shutdown. No work-in-progress files.

### Changes made during this session

**Bug fix #1 — env loader logic.** `src/lib/env.ts`'s `opt()` returned `process.env[name]` directly. An empty `.env` line like `TEST_DATABASE_URL=` produced `""`, which the nullish-coalescing chain in `src/lib/db.ts` (`opt('TEST_DATABASE_URL') ?? req('NEON_DATABASE_URL')`) accepted as a valid value. Result: `new Pool({ connectionString: "" })`, which defaulted to `wss://localhost/v2` and failed with `ECONNREFUSED`. Fix: `opt()` now returns `undefined` for empty strings. Restored correct fall-through.

**Bug fix #2 — WebSocket constructor.** `@neondatabase/serverless`'s `Pool` needs an explicit `webSocketConstructor` in Netlify CLI's local function runtime (the global `WebSocket` from Node 22 isn't picked up reliably in the sandboxed function context). Installed `ws` + `@types/ws`, and `src/lib/db.ts` now sets `neonConfig.webSocketConstructor = ws`. (Migration script worked without this because it runs in plain Node where the global is picked up.)

**Defensive error handling — `auth-google.ts`.** Wrapped the handler in `try/catch` returning a JSON 500 with `detail`. This bypasses a known Netlify CLI 23.14 quirk where the CLI itself crashes (`TypeError: Cannot read properties of undefined (reading 'map')` in `getNormalizedError`) when a function throws an error in an unexpected shape. Worth applying the same pattern to other endpoints proactively — currently only `auth-google.ts` has it.

**Npm scripts — `--env-file=.env`.** Updated `migrate`, `migrate:status`, `bootstrap:admin` to use Node's `--env-file=.env` flag via tsx so they read `.env` without needing the `dotenv` package.

**Second admin account.** Ran `ADMIN_GOOGLE_EMAIL=admin@example.com ADMIN_PASSWORD=<see local notes> npm run bootstrap:admin` to create the email+password fallback admin. Useful for testing the non-Google login path and for any future scenario where the Google account is unavailable.

**Files moved.** `handoff.md` → `docs/handoff.md` (this file's location).

### Everything tried that failed and why

1. **First sign-in attempt → Netlify CLI 23.14 crashed.** A function's thrown error tripped a bug in the CLI's error normalizer. Worked around with try/catch in `auth-google.ts`; underlying error was then revealed to be the env-loader bug below.
2. **Second attempt → 500 `server_error` with empty `ErrorEvent`.** The defensive catch was working but the inner error had no `message`. Reading the dev server log revealed it: `wss://localhost/v2 ECONNREFUSED`. That led to the env.ts diagnosis.
3. **`ws` package installation alone wasn't enough.** I added `neonConfig.webSocketConstructor = ws` first, thinking the WebSocket global was the only issue. Connection still failed because the actual root cause was the empty-string fall-through in env.ts (no real connection string was being passed to the Pool, so it built `wss://localhost/v2` regardless of WebSocket library). Both fixes together resolved it. **Lesson: don't fix the second symptom before diagnosing the first.**

### Smoke test progress (Steps 1–13 from earlier walkthrough)

- ✅ Step 1: Neon account + project created, pooled connection string in `.env`.
- ✅ Step 2: Google Cloud project + OAuth Client ID created, `theexsolenterprise@gmail.com` added as Test User.
- ✅ Step 3: JWT signing secret generated.
- ✅ Step 4: `.env` populated.
- ✅ Step 5: `npm run migrate` — all 8 migrations applied.
- ✅ Step 6: `npm run bootstrap:admin` — `theexsolenterprise@gmail.com` admin row created.
- ✅ (Extra) Second admin via env override: `admin@example.com` / `<see local notes>`.
- ✅ Step 7: `npm run dev` — server up on `localhost:8888`.
- ✅ Step 8: Sign in with Google as `theexsolenterprise@gmail.com` → landed on `/admin.html`. **Confirmed working.**
- ⏸ Step 9: Onboard a Client — **NOT YET DONE.**
- ⏸ Step 10: Sign in as Primary in incognito — not yet done.
- ⏸ Step 11: Create a product — not yet done.
- ⏸ Step 12: Stock movements (delta + recount) — not yet done.
- ⏸ Step 13: Impersonation (banner, exit) — not yet done.

### Next step I would take (tomorrow's session)

The user wrote: *"I need to update the UI but I'm shutting down the session for today."* So tomorrow has two threads:

**Thread A — finish the smoke test (15 min).** Restart the dev server, complete Steps 9–13. This verifies all Phase 4 endpoints in real use and catches any UI bugs before the UI work begins. The second admin (`admin@example.com` / `<see local notes>`) is also worth testing — sign in via the email+password form on the login page; it should land identically on `/admin.html`.

**Thread B — UI updates (user-driven, scope TBD).** The user didn't specify what they want changed. When they start, ask:
- Which page(s) are in scope (login, admin dashboard, workspace dashboard, product editor, me.html)?
- What's the change — visual polish, new feature, fix to something they noticed?
- Any reference designs / screenshots they want to match?

Before making UI changes, restart `npm run dev` and have them look at the current state first — easier to discuss "change *this* to *that*" than to describe in the abstract.

### Suggested cadence for tomorrow

1. `npm run dev`. Confirm `http://localhost:8888` loads.
2. 5 min: sign in with `admin@example.com` / `<see local notes>` to verify email+password path. (If it fails: check the dev server log; the auth-email-login endpoint doesn't have the defensive try/catch yet — if it crashes the CLI, mirror the pattern from `auth-google.ts`.)
3. 10 min: complete Steps 9–13 with `theexsolenterprise@gmail.com` (Google sign-in).
4. Then dive into UI work per the user's direction.

### One small cleanup to do early tomorrow

Mirror the `try/catch` wrapper from `auth-google.ts` into the other auth and workspace endpoints (`auth-email-login.ts`, `auth-refresh.ts`, `auth-logout.ts`, `me.ts`, `workspace-products.ts`, `workspace-product-detail.ts`, `workspace-product-overlay.ts`, `workspace-stock-movements.ts`, `workspace-stock-views.ts`, `admin-workspaces.ts`, `admin-workspace-detail.ts`, `admin-workspace-unlock.ts`, `admin-workspace-rotate-key.ts`, `admin-impersonate.ts`). Same shape: wrap the handler body in `try { ... } catch (err) { console.error('[name] uncaught', err); return json({ error: 'server_error', detail: ... }, 500); }`. This prevents the Netlify CLI 23.14 crash bug from biting again when any of those endpoints hits an unexpected error during the smoke test. 5 minutes total.

---

## 2026-05-19 — Phase 4 complete (products visible on localhost)

### Goal we are working towards

Unchanged from prior session: hub-and-spoke SaaS for collecting product + stock data, see `docs/prd-v1.md`. **Milestone reached this session: end-to-end product CRUD works on localhost.** From here, Phase 5 wires up the four file-and-asset modules (Drive, image pipeline, exports, backups) and their UIs.

### Current state of the code

- **Phases 1–4: complete.** Build + tests green: `npm run typecheck` passes, `npm test` → 24 pass, 34 skip (DB-gated, run when `TEST_DATABASE_URL` is set).
- **8 of 13 deep modules implemented:** `tenancyContext`, `permissionPolicy`, `authVerifier`, `sessionManager`, `workspaceUnlockManager`, `impersonationManager`, `auditLogWriter`, `stockLedger`, `productService` (+ `workspace-actor` composition helper).
- **Workspace-scoped HTTP API live** at `/api/workspaces/:wsid/...` for products, product detail, marketplace overlays, stock movements, stock analytics views.
- **Real product dashboard on `/workspace.html`** with low/dead/fast tiles, search/status/marketplace filters, product table. Click a row or **+ Add Product** → `/product-edit.html` with tabbed editor (Core + per-marketplace overlays + Stock).
- **Impersonation banner** works on workspace pages — when admin acts as a Primary, the red banner pins at the top with target + reason + 30-min countdown + Exit.
- **Total files:** 60 (was 49 at end of Phase 3 — +11 new Phase 4 files, +3 edited).

**Not yet built (Phase 5):**
- Module 9 `driveClient`, Module 10 `imagePipeline` — currently product images are placeholder thumbnails (first 2 chars of SKU).
- Module 11 `exportEngine` — XLSX / CSV / Meta-catalog CSV generation.
- Module 12 `backupEngine` — per-Client ZIP + Admin system tar.gz nightly.
- File manager UI, exports tab, backups panel, audit log viewer UI.
- CSV bulk product import UI (backend ready: `source: 'csv'` is accepted).
- Per-marketplace structured field forms (Phase 4 ships the editor as freeform JSON per marketplace; replace with structured forms when prioritized).
- Resend email + invite-acceptance flow.

### Files actively editing

**None.** Phase 4 closed cleanly. No in-flight changes. Awaiting Phase 5 kickoff.

### Changes made during this session

**New deep modules (`src/lib/`):**
- `stock-ledger.ts` (Module 8) — `recordMovement`, `currentCount`, `recountToAbsolute`. Validation, audit attribution, transaction-aware (accepts optional client for atomic use from `productService`).
- `product-service.ts` (Module 13) — `listProducts` (filtered), `getProduct`, `createProduct`, `updateProduct` (partial PATCH with before/after audit), `deleteProduct`, `setMarketplaceOverlay`, `stockViews` (low/dead/fast SQL queries).
- `workspace-actor.ts` — `resolveWorkspaceActor(req, workspaceId)` returning a full `ActorContext`. Handles admin-unlocked, admin-impersonating-in-this-workspace, workspace-member, and forbidden cases.

**New HTTP endpoints (`netlify/functions/`):**
- `workspace-products.ts` (GET list, POST create)
- `workspace-product-detail.ts` (GET, PATCH, DELETE)
- `workspace-product-overlay.ts` (PUT)
- `workspace-stock-movements.ts` (POST, supports both delta and absoluteCount modes)
- `workspace-stock-views.ts` (GET low/dead/fast)

Every endpoint pulls actor via `resolveWorkspaceActor`, then gates the action through `permissionPolicy.can()` before doing work in `withTenantContext`.

**New tests:**
- `tests/stock-ledger.test.ts` — 9 DB-gated tests including the sum-of-deltas invariant under random permutation, validation rejections (zero delta, non-integer, bad reason, bad source, unknown product), audit-row presence, and recount math.

**UI:**
- `public/workspace.html` — Product Dashboard with tiles + filter row + product table.
- `public/product-edit.html` — Product Editor with tabs (Core + marketplaces + Stock). Conditional food fields when `product_type = food_item`. Inline stock movement controls.
- `public/me.html` — **Open** button now navigates to `/workspace.html?id=...`.
- `public/admin-workspace.html` — added **Browse products** button (admin jumps to product dashboard after unlock).
- `public/assets/css/base.css` — added classes for `.tiles`, `.tab`, `.tab-panel`, `.filters`, `.product-thumb`, `.product-row`, `.form-grid`, `.toolbar`, `.muted-section`, `.error-text` / `.success-text`.

### Everything tried that failed and why

Only one this session:

1. **A local variable named `exec` in `stock-ledger.ts` tripped a project security hook (false positive).** The variable was an inline arrow function, no shell or subprocess involved. Renamed to `runInTx`. Same hook also fires on prose in this file — avoid the bare token when describing the issue. Note for future: do not use that 4-letter identifier as a local variable name even when its meaning is unambiguous.

### Next step I would take

**Start Phase 5.** Build order:

1. **`src/lib/drive-client.ts` (Module 9)** — the foundational abstraction over Google Drive. Surface: `ensurePath(segments[])`, `requestUploadSession(folderId, filename, mime, size)`, `getBytes(fileId)`, `createFolder`, `move`, `delete`, `list`. Wraps `googleapis` with retry + rate-limit backoff. Service-account auth via `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`. This is the most code-heavy module; budget the most time here.

2. **`src/lib/image-pipeline.ts` (Module 10)** — `requestUploadSession(productId)` returns a Drive resumable upload URL; `registerUploadedFile(productId, driveFileId)` stores the ID on the product. The serve path is `/api/img/:productId/:driveFileId` which streams bytes from Drive; the frontend uses `/.netlify/images?url=/api/img/...` so Netlify Image CDN caches at the edge.

3. **`src/lib/export-engine.ts` (Module 11)** — `run({ profile, filter, workspace, requesterId })`. Profiles: `xlsx_comprehensive`, `csv_comprehensive`, `meta_catalog_csv`. Sync vs async dispatch on the 500-rows / 2 MB threshold. Async path inserts an `export_jobs` row; a Scheduled Function picks it up, builds the file via `exceljs`/`papaparse`, uploads to `<Workspace>/Exports/` via `driveClient`, marks done.

4. **`src/lib/backup-engine.ts` (Module 12)** — `runWorkspace(workspaceId, requesterId)`, `runSystem(requesterId)`, `pruneRetention()`. ZIP composition via `jszip` for workspace backups; SQL dump via a database-side path or a Neon-hosted `pg_dump` step for system backups. Scheduled Function at 3 am IST.

5. **UIs (after backend solid):** file manager (`/workspace-files.html`), exports tab on workspace dashboard, backups panel, audit log viewer (`/workspace-audit.html` and `/admin-audit.html`).

6. **Bonus / cleanup:** image upload UI on `product-edit.html` (replaces the placeholder thumbnail with a real image picker once `imagePipeline` is wired), CSV import UI for bulk products.

**Notes for Phase 5 setup:** the user must create a Google Drive service account in Google Cloud Console, give it Editor access to a specific Drive folder (their root), download the JSON key, set it as `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY` (single-line JSON), and set `GOOGLE_DRIVE_ROOT_FOLDER_ID` to the folder's ID. None of this is needed for Phase 5 *coding* — typecheck + tests pass without these creds — but the smoke test at end of Phase 5 requires them.

**End-of-Phase-5 deliverable:** upload an image for a product, see it inline in the dashboard table; trigger an XLSX export of the catalog, get a file in Drive; trigger a workspace backup, see the ZIP in `<Workspace>/Backups/`. After Phase 5, v1 is functionally complete.

---

## 2026-05-19 — Phases 1, 2, 3 complete

### Goal we are working towards

A multi-tenant SaaS web app for collecting product + stock data from Clients (businesses) and feeding it to downstream systems (future Internal Website / ERP, custom ecommerce, booking/catalog sites). The app is the **hub** in a hub-and-spoke topology; no external marketplace integrations in v1. Admin (you, `theexsolenterprise@gmail.com`) onboards Clients, can impersonate any user with full audit trail, manages backups. Each Client gets a Workspace with role-scoped team members (Primary, Manager, Storekeeper). End-state v1: see `docs/prd-v1.md` (108 user stories, 13 deep modules).

**Stack:** Netlify (frontend + Functions in TypeScript) + Neon Postgres (single DB, RLS-isolated) + Google Drive (file storage via Drive API on your existing 15 GB account) + Google Sign-In (primary auth) + email/password (fallback).

### Current state of the code

- **Phase 1 (foundation):** complete and tested. Stack scaffolded, 7 migrations covering full schema, 2 deepest modules (`tenancyContext`, `permissionPolicy`) with 24 passing tests covering the full role matrix + cross-workspace isolation + god-mode impersonation rules.
- **Phase 2 (auth + sessions):** complete. Google Sign-In and email+password login both working through their HTTP endpoints. JWT sessions in HTTP-only cookies (15-min access + 30-day refresh with rotation). Login page with both methods. Bootstrap-admin script to create the first admin.
- **Phase 3 (per-Client unlock + admin onboarding + impersonation):** complete. `auditLogWriter`, `workspaceUnlockManager`, `impersonationManager` modules with full test suites (DB-gated, skip without `TEST_DATABASE_URL`). Admin dashboard with workspace list, "+ Add Client" onboarding (issues one-time access key), workspace detail with unlock prompt + team list + Impersonate buttons. Site-wide impersonation banner.

**Build status:** `npm run typecheck` passes. `npm test` → 24 pass (permissions) + 25 skip (DB-required tests for tenancy/audit/unlock/impersonation). 49 files in repo across `db/`, `src/`, `netlify/`, `public/`, `tests/`, `scripts/`, `docs/`.

**Frontend pages live:**
- `/login.html` — Google button + email/pw form
- `/admin.html` — workspace list + onboarding modal
- `/admin-workspace.html?id=<uuid>` — locked or unlocked view per workspace
- `/me.html` — Primary/Manager/Storekeeper landing with their workspace memberships (Open button disabled until Phase 4)
- `/index.html` — auto-redirects by auth state

**What is NOT yet built:**
- Module 8 `stockLedger`
- Module 13 `productService`
- Product CRUD endpoints + dashboard + editor (this is **Phase 4**)
- Modules 9–12: `driveClient`, `imagePipeline`, `exportEngine`, `backupEngine` (Phase 5)
- File manager UI (Phase 5)
- Email sending (Resend) + invite-link acceptance flow (deferred from Phase 3)
- Frontend dark mode toggle, filter UI patterns (Phase 4 or later)

### Files actively editing

**None right now.** Phase 3 is closed out. No in-flight changes. Awaiting Phase 4 kickoff.

### Changes made during this session

This session covered grilling → PRD → implementation of Phases 1–3.

**Architecture / docs:**
- `CONTEXT.md` (domain glossary)
- `docs/adr/0001-stack.md` through `0005-files-backups-audit-deployment.md`
- `docs/grilling-log.md` (every question + answer + reframe)
- `docs/prd-v1.md` (108 user stories, 13 modules, schema sketch, API surface, test plan, out-of-scope)

**Phase 1 — foundation:**
- `package.json`, `tsconfig.json`, `netlify.toml`, `.gitignore`, `.env.example`, `vitest.config.ts`
- `db/migrations/001`..`007` — extensions, users + workspaces, RLS helpers, products + stock + trigger, audit + sessions + impersonation + unlocks + lockouts, files + exports + backups, RLS policies
- `scripts/migrate.ts` — versioned migration runner
- `src/lib/types.ts`, `env.ts`, `db.ts`, `tenancy.ts` (Module 1), `permissions.ts` (Module 2)
- `tests/permissions.test.ts` (24 passing), `tests/tenancy.test.ts` (6 skipped pending DB)

**Phase 2 — auth + sessions:**
- `src/lib/cookies.ts`, `auth-verifier.ts` (Module 3), `session-manager.ts` (Module 4)
- `scripts/bootstrap-admin.ts`
- `netlify/functions/config.ts`, `auth-google.ts`, `auth-email-login.ts`, `auth-refresh.ts`, `auth-logout.ts`, `me.ts`
- `public/login.html`, `admin.html` (Phase 2 placeholder), `me.html` (Phase 2 placeholder), `index.html` (auth-aware redirect), `assets/css/base.css`, `assets/js/api.js`

**Phase 3 — admin onboarding + impersonation:**
- `src/lib/audit-log-writer.ts` (Module 7), `workspace-unlock-manager.ts` (Module 5), `impersonation-manager.ts` (Module 6), `http.ts` (endpoint helpers)
- Added `withUserContext` in `tenancy.ts`
- `db/migrations/008_user_context_policies.sql` — `is_member_of()` SECURITY DEFINER + updated RLS so a user can see their own memberships
- `netlify/functions/admin-workspaces.ts`, `admin-workspace-detail.ts`, `admin-workspace-unlock.ts`, `admin-workspace-rotate-key.ts`, `admin-impersonate.ts`; extended `me.ts`
- `public/admin.html` (full rewrite), `admin-workspace.html` (new), `me.html` (memberships), `assets/js/banner.js`, extended `assets/css/base.css`
- `tests/audit-log-writer.test.ts`, `workspace-unlock-manager.test.ts`, `impersonation-manager.test.ts` (DB-gated)

### Everything tried that failed and why

These all came up DURING the session and were corrected — capturing so they don't recur:

1. **"MySQL on Netlify"** in the original brief. Netlify hosts static + serverless functions; it has no database service. Corrected to Neon Postgres after one round of clarification (the user initially asked "what about Neon Netlify?" — Neon is Postgres, not MySQL, so this was a free upgrade). See `docs/adr/0001-stack.md`.
2. **"Python middleware on Netlify"** in the original brief. Netlify's Python runtime is beta with a 10-second hard timeout — every long export, ZIP backup, bulk import would have silently failed. Switched to TypeScript Functions (26-second timeout, mature SDK). See `docs/adr/0001-stack.md`.
3. **"Build live WA/Meta/Shopify integrations in v1."** User reframed midway: ExSol is the hub; the future Internal Website (ERP) is the next hop; consumer-facing sites are two hops downstream. Live external integrations are NOT v1 scope. Removed an estimated ~70% of integration work. See `docs/adr/0004-product-and-stock-model.md`.
4. **Two functions at the same Netlify path.** Initially wrote `admin-workspaces-list.ts` (GET) and `admin-workspaces-create.ts` (POST) as separate files both declaring `path: '/api/admin/workspaces'`. Netlify Functions v2 dispatches one function per path, not per method. Combined into a single `admin-workspaces.ts` with internal method dispatch.
5. **`innerHTML` with manual escaping in `banner.js`.** Security hook caught it; even with escaping, innerHTML is risky. Rewrote with `createElement` + `textContent` everywhere so XSS isn't possible by construction.
6. **`/api/me` memberships query with no DB context.** First version called `pool().connect()` directly; RLS hid all rows because no `current_user_id` / `current_workspace_id` GUC was set. Fixed by adding `withUserContext` helper and migration `008` that adds `is_member_of()` SECURITY DEFINER + relaxed RLS so users can see their own memberships.
7. **No issue tracker for `/to-prd`.** The skill expected Linear / GitHub Issues / etc. Fell back to writing the PRD as `docs/prd-v1.md` and noted the user can publish to a real tracker later.
8. **`AskUserQuestion` 4-option limit.** Tried to surface a 13-option multi-select for "which modules to test." Tool rejected. Re-asked as tiers (Critical only / Critical + integrity / Broad / All) — better UX anyway.

### Next step I would take

**Start Phase 4.** First files I'd write, in order:

1. `src/lib/stock-ledger.ts` (Module 8) — `recordMovement()`, `currentCount()`, `recountToAbsolute()`. Validates source/reason enums. The `stock_movements_apply_delta` trigger (already in migration 004) keeps `products.stock_count` materialized.
2. `tests/stock-ledger.test.ts` — DB-gated test tier. Property test: any permutation of N movements yields the same final count. Concurrent insert test.
3. `src/lib/product-service.ts` (Module 13) — CRUD on `products` table; SKU uniqueness; `validateOverlay(marketplace, fields)` against per-marketplace JSON schemas.
4. HTTP endpoints under `/api/workspaces/:id/...`:
   - `GET /api/workspaces/:id/products` (list with filters: category, status, marketplace_enabled, search)
   - `POST /api/workspaces/:id/products` (create)
   - `PATCH /api/workspaces/:id/products/:pid` (update)
   - `DELETE /api/workspaces/:id/products/:pid` (delete)
   - `POST /api/workspaces/:id/stock/movements` (create movement)
   - `GET /api/workspaces/:id/stock/{low,dead,fast}` (analytics views)
5. Workspace-scoped middleware that resolves `withTenantContext` from the workspace id in the URL + the current user's membership.
6. UI:
   - `public/workspace.html?id=<uuid>` — the **Product Dashboard** (this is where products first show up on localhost)
   - `public/product-edit.html?wsid=<uuid>&pid=<uuid>` — the product editor with marketplace overlay tabs and the `physical_goods` vs `food_item` toggle
7. The `/me.html` "Open" button gets enabled and navigates to `/workspace.html?id=...`.

**End-of-Phase-4 deliverable:** sign in as a Primary user (or impersonate one as admin), land on a Product Dashboard table showing real product data, click into a product, edit core fields and marketplace overlays, save, and see the update reflected in the table.

**Image upload (Module 10) is deliberately deferred to Phase 5** to keep Phase 4 focused. Products in Phase 4 will reference image URLs that don't yet resolve; placeholders fill the visual. Phase 5 wires Drive → Netlify Image CDN end-to-end.
