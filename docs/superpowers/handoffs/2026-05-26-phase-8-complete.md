# AMS v2 — Handoff after Phase 8

**Date:** 2026-05-26
**Branch:** `main` (unpushed)
**Latest commit:** `035f03a feat(admin-team): admin-self + admin-team CRUD + AdminSettings UI (Phase 8)`
**Status:** Phases 0–8 shipped locally. Working tree clean. 112 tests pass. Typecheck + production build clean.

---

## TL;DR for the next agent

Phases 0–8 of the AMS v2 plan
(`docs/superpowers/plans/2026-05-26-ams-v2-implementation.md`) are complete.
The remaining work (Phases 9–12) is small: a client dashboard page, a seed script,
three ADRs, a README rewrite, and a deploy-preview smoke test before promoting to prod.

**Pick up at Phase 9.** Plan starts at line 2461.

---

## What ships in Phase 8

- `netlify/functions/admin-self.ts` — PATCH, updates own `display_name` and/or `password`.
  Body validated by Zod (`min(8)` password). Uses argon2 via `_shared/argon.ts`.
- `netlify/functions/admin-team.ts` — GET lists admins (bootstrap-first, then by `created_at`),
  POST creates a new non-bootstrap admin. Translates Postgres `23505` → 409 `email_taken`
  and `23514` (CHECK violation when no credential supplied) → 400 `credential_required`.
- `netlify/functions/admin-team-detail.ts` — DELETE. **Precedence:** lookup → bootstrap-check →
  self-check. Bootstrap-first matches the UI tooltip precedence and was a real bug
  surfaced by the test suite.
- `src/modules/ams/components/AddAdminModal.tsx` — modeled on `AddClientModal.tsx`.
- `src/modules/ams/pages/AdminSettings.tsx` — Your-account form, Admin team table with
  per-row delete (disabled for bootstrap and self with explanatory tooltips),
  Danger zone → sign out.
- `src/modules/ams/api.ts` — adds `listAdminTeam`, `createAdmin`, `deleteAdmin`,
  `updateAdminSelf`, `AdminMember` interface.
- `tests/integration/admin-team.test.ts` — 11 tests (happy paths + auth + 409 precedence).

## Phases 0–7 — already done (recap)

| Phase | Summary | Commit |
| --- | --- | --- |
| 0 | Cleanup + drop old v1.1 schema (39 entities across both Neon endpoints) | `f4309da` |
| 1 | Scaffold (configs, aliases, tooling) | `08b3b82`, `61aec66`, `3239ffa` |
| 2 | Public schema + bootstrap admin (6 migrations, bootstrap script) | (5 commits) |
| 3 | Login module — auth-login/google/me/logout + login UI + rate-limit + cookie session | (~16 commits) |
| 4 | AMS shell (themed sidebar + empty pages) | `fb50bee` |
| 5 | Templates + DDL generator + Bucket abstraction (6 templates, golden snapshots) | `9a41628` … `d4d187a` |
| 6 | Clients CRUD (POST/GET/DELETE + AddClientModal + ClientCard + dashboard wiring) | `b2170ca`, `8fd69f5` |
| 7 | Bucket CRUD (3 endpoints + singleton concurrency test + ClientSettings + BucketPanel + dynamic Add/EditUser modals) | `7914263`, `7a1ee14` |
| 8 | Admin team (3 endpoints + AddAdminModal + AdminSettings + 11 tests) | `035f03a` |

## What's NOT done — Phases 9–12

### Phase 9 — ClientDashboard + dummy seed
Plan §2461. Two tasks:
- **9.1:** `src/modules/ams/pages/ClientDashboard.tsx` — fetch `/api/clients-detail` and
  `/api/clients-buckets`, render header + bucket overview table. Replace the
  `ClientDashboardStub` in `src/lib/router.tsx:8-15` and remove the stub.
- **9.2:** `scripts/seed-dummy-clients.ts` — idempotent server-side seeder
  (Joe's Hardware/shop, Bistro Verde/restaurant, St Mercy Hospital/hospital).
  Reuses `createClientSchema` and `Bucket.add()` directly — does NOT hit HTTP.
  Looks up bootstrap admin via `SELECT id FROM public.admins WHERE is_bootstrap = true LIMIT 1`.
  Spec §8.9 lists exact seed rows.

### Phase 10 — Reconcile + ADRs + README
Plan §2511.
- `scripts/reconcile-clients.ts` (no-op walker for v1, full code in plan §2519-2550).
- Three ADRs in `docs/adr/`:
  001-per-client-schemas, 002-hardcoded-templates-with-versioning, 003-no-rls-admin-only.
- Replace `README.md` (template in plan §2574).

### Phase 11 — Deploy preview smoke
Plan §2585. Push a feature branch, watch Netlify build, hit the preview URL,
run the manual smoke script (login → dashboard → add doctor → delete → sign out).
**⏸ Review checkpoint** before Phase 12.

### Phase 12 — Promote to prod
Plan §2617. Re-verify prod Neon migrations are at the version the code expects
(see `feedback_migration_before_deploy.md` — separate dev/prod branches bit us before),
then merge `main`.

## Tools / commands

```bash
npm run typecheck      # tsc --noEmit (must be clean before commit)
npm test               # vitest run (full suite)
npm test -- tests/integration/admin-team.test.ts   # focused
npm run build          # tsc --noEmit + vite build
npm run dev            # vite dev server
npm run migrate        # runs all SQL in db/migrations/ against $DATABASE_URL
```

Integration tests require `DATABASE_URL` pointing at the **Neon dev** branch
(see `tests/setup-env.ts`). They invoke handlers directly with constructed
`Request` objects — no `netlify dev` needed.

## Gotchas the next agent should know

1. **Dev vs prod Neon branches are separate.** Run `npm run migrate` against the
   prod URL *before* promoting code that depends on a new migration. See
   `feedback_migration_before_deploy.md`.

2. **Netlify deploy 4-item pre-flight.** `NPM_FLAGS=--production=false`,
   `external_node_modules` includes `@node-rs/argon2`, all env vars set per context,
   `COOKIE_SECURE=true` in prod. See `feedback_netlify_deploy_checklist.md`.

3. **Netlify Functions v2 routing.** Don't put literal sub-paths under `:param` routes —
   they collide. See `feedback_netlify_routing.md`. We sidestep this with
   discrete `clients-detail`, `clients-buckets`, `clients-bucket-users`,
   `clients-bucket-user-detail`, `admin-self`, `admin-team`, `admin-team-detail` —
   no param-segment overloading.

4. **Always run typecheck before commit.** Runtime checks (tsx, ad-hoc scripts) do
   not exercise TS types. See `feedback_implementer_verify_typecheck.md`.

5. **Error-code precedence is a contract.** When two reasons could explain a 409,
   the API's choice should match what the UI explains. Phase 8 surfaced this
   (bootstrap-admin-as-self collision); the test caught it.

6. **Bucket singleton enforcement is real.** Tests in
   `tests/integration/buckets-cardinality.test.ts` fire concurrent POSTs and
   assert exactly one 201 + one 409. Any future changes to the `Bucket` class
   must keep that invariant — `Bucket.add()` uses a singleton-guarded SELECT
   FOR UPDATE pattern; don't loosen it.

7. **`verifyPassword(plain, null)` runs against a dummy hash** so latency
   doesn't leak account existence. Don't add an early-return on `null hashed`.

## Test counts

- Before Phase 8: 101 tests (10 files).
- After Phase 8: **112 tests (11 files)**.

## Memory pointers (auto-memory at `~/.claude/projects/.../memory/`)

Already on file and relevant:
- `feedback_netlify_routing.md`
- `feedback_migration_before_deploy.md`
- `feedback_verify_neon_endpoint_before_drop.md`
- `feedback_implementer_verify_typecheck.md`
- `feedback_netlify_deploy_checklist.md`

No new feedback memory needed from Phase 8 — the bootstrap-first precedence
question is too situation-specific to be worth a memory entry; the test that
caught it is the durable artifact.

## Where to start the next session

1. `cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol Data Collection App"`
2. `git log --oneline -3` — confirm `035f03a` is latest.
3. `npm test` — confirm 112 green.
4. Open `docs/superpowers/plans/2026-05-26-ams-v2-implementation.md` at line **2461** (Phase 9).
5. Phase 9 first deliverable is `src/modules/ams/pages/ClientDashboard.tsx`; replace the stub in
   `src/lib/router.tsx:8-15`.
