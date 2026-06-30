# Handoff — Booking Module (2026-06-29)

> Durable replacement for the old `/tmp/handoff-exsol-merged-*.md` workflow. **Do not use `/tmp` for handoffs** — macOS's daily `periodic` job deletes `/tmp` files untouched for ~3 days (this is why the June-8 file vanished despite no reboot). Keep handoffs in-repo.

## Mission & scope
This chat owns the **Booking module ONLY**, in worktree `../ExSol-Booking-WT` on branch `feat/booking-module-iso`. **Local commits only — never push or merge.** A parallel chat owns `main`/prod/integration. (Memory: `project_parallel_chat_login_ams_scope`, `feedback_parallel_chat_worktrees`.)

## Don't re-derive — read these artifacts
- **Design spec (all decisions locked):** `docs/superpowers/specs/2026-06-29-booking-module-design.md` — 6 sections, 7 forks (Q1–Q7) + §4 sub-forks resolved. Reconstructed from the lost session transcript `~/.claude/projects/<proj>/65b6d6fc-5534-4431-8bbd-882d63df7099.jsonl`.
- **Phase 1 plan (TDD, build order A→J):** `docs/superpowers/plans/2026-06-29-booking-module-foundation.md`.
- **Live short handoff:** `.remember/remember.md` (same facts, terser).
- **Cross-chat hazard:** memory `project_booking_migration_number_coordination`.

## Status (branch HEAD `57bd770`)
Phase 1 (Foundation) is **code-complete**; only the DB apply is blocked.
- `b11e14e` — pure engine `src/modules/booking/lib/{tz,dedupe,fsm,availability,autoassign}.ts` + `__tests__/`: **24 unit tests green, typecheck clean**. (Executing it caught a real `noUncheckedIndexedAccess` defect, fixed in code + plan.)
- `57bd770` — migrations `db/migrations/043_booking_core.sql` + `044_bookings.sql`, plus `tests/booking/{_helpers.ts,gist-overlap.test.ts}`: typecheck clean, **UNAPPLIED / unrun**.

## Blocker — RESOLVED (2026-06-30)
Numbering coordinated: POS-v2 is zero-migration → **Booking owns 043–045, now APPLIED to dev**. Phase 1 is fully green: **29 tests** (24 pure + 5 gist integration), typecheck clean. The gist no-overbook proof passes against the real schema. (Splitter gotcha hit + fixed — memory `feedback_migrate_splitter_inline_comment`.) Prod still needs `npm run migrate` against the prod URL before promoting dependent code.

## Architecture facts that aren't obvious from code yet
- No-overbook = `EXCLUDE USING gist (resource_id WITH =, time_range WITH &&) WHERE status IN ('pending','confirmed','blocked')`. A bare `INSERT` is atomic → concurrent bookings give one 201 + one 409 (`23P01`). No `slots` table; availability is computed on-read.
- `bookings.user_node_id`/`service_id` are **nullable + status CHECK** (blocked staff-time has no customer/service) — intentional deviation from the spec's NOT NULL.
- Pure logic is **single-source** in `src/modules/booking/lib/`; Netlify functions import it via `../../src/…` (7 functions already cross that boundary). Do **not** duplicate like POS did.
- Built-in `Intl` for tz (no date lib added). **Razorpay + scheduled cron are GREENFIELD.** The spec's "30s Blobs availability cache" was dropped (module-level Maps banned; no Blobs version-counter exists).

## Phase 2 plan: WRITTEN (commit 9a9cffe)
`docs/superpowers/plans/2026-06-29-booking-module-phase2-api.md` — full TDD code bodies, Tasks 1–13 (backend only; UI is Phase 3). Decisions baked in:
- **Perms = bucket×verb** `booking.{customers,employees}.*` (action keys rejected by platform validator — memory `feedback_permission_keys_bucket_verb_only`). FSM/spec/plan all aligned (commit abae38d).
- `requireBooking` gates on the booking **module** reachable from enabled products (not a product key).
- Customer dedupe: `user_nodes` already has `phone` + unique `(client_id, lower(email))`; bucket = role's `bucket_family`. Migration 045 = just a `(client_id, phone)` index. Upsert matches email/phone among `bucket_family='customers'` nodes.
- Public create maps `23P01`→409; concurrency test proves 1×201/9×409.

**4 open items flagged in the plan** (don't fabricate): Netlify v2 array `config.method`; customers-bucket role seeding for the upsert; neon nested `sql` fragments in availability; migrations 043–045 still UNAPPLIED (numbering coordination).

## Phase 2: EXECUTED & COMPLETE (2026-06-30)
All 13 tasks implemented TDD-style and green: **66 booking tests (17 files), typecheck clean**. Functions live under `netlify/functions/booking-*.ts` + `_booking-{authz,validators,customer-upsert}.ts`; test helpers extended in `tests/booking/_helpers.ts`. The no-overbook guarantee is proven at the HTTP layer (concurrency test: 10 parallel → 1×201/9×409). Open items all resolved (see Phase 2 plan banner). **Product dependency surfaced:** guest bookings need a tenant `client_roles` row with `bucket_family='customers'` — the upsert throws `no_customer_role` otherwise; Phase 3 should auto-seed one when booking is enabled.

## Phase 3a (backend): EXECUTED & COMPLETE (2026-06-30)
Vendor ops (`booking-list`, `booking-detail` w/ FSM transitions, `booking-manual-create` incl. blocked staff-time), `booking-public-manage` (magic-link cancel), `booking-pending-cleanup` (scheduled, 15-min timeout), `_booking-razorpay` + `booking-razorpay-webhook` (HMAC verify + pending→confirmed), and a round-trip smoke. **Full suite: 24 files, 86 tests green; typecheck clean.** Deferred to deploy: live Razorpay order-create (public-create still returns a `payment_intent` stub), netlify.toml schedule registration, and `RAZORPAY_*` env vars across contexts.

## Next focus: Phase 3b — React UI (NOT started)
Public storefront pages (ServicePicker→SlotPicker→Checkout+Razorpay Checkout JS→Confirmation, ManageBooking) under `src/modules/booking/public/`; vendor pages (day-view CalendarPage, BookingsList, Services, Resources, Settings, manual/blocked drawers) under `src/modules/booking/vendor/`; `BookingRouteMounts.tsx` (mirror `PosRouteMounts`), `src/lib/router.tsx` entries, sidebar nav (`useNavItems` `MODULES_WITH_DEDICATED_NAV`). Needs an FE-pattern exploration pass first + browser/`run`-skill verification (not just unit tests). See plan `docs/superpowers/plans/2026-06-30-booking-module-phase3.md` §3b.

## (was) Next focus
Either (a) clear the migration-numbering blocker → apply 043–045 → run Phase 1 gist proof + Phase 2 integration/concurrency tests, or (b) execute Phase 2 task-by-task (validators/authz unit-testable now; DB-backed tasks wait on (a)). Then **Phase 3** = payments (Razorpay + webhook), magic-link manage, vendor calendar/list/detail/manual-create, pending-cleanup cron, sidebar nav, all React UI (E–J). Mirror POS: `netlify/functions/pos-*.ts`, `_pos-authz.ts`, `tests/pos/_helpers.ts`, `src/modules/pos/`, `src/lib/router.tsx`, `useNavItems.ts` (`MODULES_WITH_DEDICATED_NAV`).

## Durable rules in play (memory slugs)
`feedback_no_push_without_approval`, `feedback_no_deploy_previews`, `feedback_implementer_verify_typecheck`, `feedback_netlify_subdir_function_discovery`, `feedback_netlify_config_path_method`, `feedback_migration_before_deploy`, `feedback_netlify_deploy_checklist`.

## Suggested skills for the next session
- `superpowers:writing-plans` — to author the Phase 2 plan from the locked spec.
- `superpowers:subagent-driven-development` or `superpowers:executing-plans` — to implement a plan task-by-task.
- `superpowers:test-driven-development` — every task is red→green→commit.
- `superpowers:using-git-worktrees` — already in the worktree; only relevant if re-isolating.
- `to-issues` / `writing-plans` — to decompose the remaining A→J buckets into atomic tasks.
