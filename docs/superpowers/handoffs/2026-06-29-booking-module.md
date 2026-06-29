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

## The one blocker
`043`/`044` may collide with the **POS-v2 chat** (also claimed `043+`) on the **shared dev DB** (`ep-bold-wildflower-…`, single `schema_migrations`). Before applying: confirm the free number range, renumber if needed, then from the worktree run `npm run migrate` → `npx vitest run tests/booking/gist-overlap.test.ts` (the no-overbook proof) → Phase 1 Task 10 green sweep. Do **not** `npm run migrate` until coordinated.

## Architecture facts that aren't obvious from code yet
- No-overbook = `EXCLUDE USING gist (resource_id WITH =, time_range WITH &&) WHERE status IN ('pending','confirmed','blocked')`. A bare `INSERT` is atomic → concurrent bookings give one 201 + one 409 (`23P01`). No `slots` table; availability is computed on-read.
- `bookings.user_node_id`/`service_id` are **nullable + status CHECK** (blocked staff-time has no customer/service) — intentional deviation from the spec's NOT NULL.
- Pure logic is **single-source** in `src/modules/booking/lib/`; Netlify functions import it via `../../src/…` (7 functions already cross that boundary). Do **not** duplicate like POS did.
- Built-in `Intl` for tz (no date lib added). **Razorpay + scheduled cron are GREENFIELD.** The spec's "30s Blobs availability cache" was dropped (module-level Maps banned; no Blobs version-counter exists).

## Next focus
Author the **Phase 2 plan** (build order C+D): `requireBooking` authz (mirror `netlify/functions/_pos-authz.ts`), settings/services/resources CRUD functions, customer match-or-create upsert + the deferred `user_nodes` dedupe index, public availability + create endpoints (map `23P01`→409), pay-at-venue happy path. Then Phase 3 = payments/manage/calendar/cron/nav/tests (E–J). Mirror the POS module throughout: `netlify/functions/pos-*.ts`, `_pos-fsm.ts`, `tests/pos/_helpers.ts`, `src/modules/pos/`, `src/lib/router.tsx`, `useNavItems.ts` (`MODULES_WITH_DEDICATED_NAV`).

## Durable rules in play (memory slugs)
`feedback_no_push_without_approval`, `feedback_no_deploy_previews`, `feedback_implementer_verify_typecheck`, `feedback_netlify_subdir_function_discovery`, `feedback_netlify_config_path_method`, `feedback_migration_before_deploy`, `feedback_netlify_deploy_checklist`.

## Suggested skills for the next session
- `superpowers:writing-plans` — to author the Phase 2 plan from the locked spec.
- `superpowers:subagent-driven-development` or `superpowers:executing-plans` — to implement a plan task-by-task.
- `superpowers:test-driven-development` — every task is red→green→commit.
- `superpowers:using-git-worktrees` — already in the worktree; only relevant if re-isolating.
- `to-issues` / `writing-plans` — to decompose the remaining A→J buckets into atomic tasks.
