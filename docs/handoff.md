# ExSol Data Collection App — Handoff

> If you are picking up this project in a fresh conversation, read this file first.
> The previous handoff (v1.1 inventory product) has been archived in the `v1.1-final` git tag.
> Recover with: `git show v1.1-final:docs/handoff.md`.

---

## TL;DR

This is a **fresh app**: an **Account Management System (AMS)** with an Admin layer, built on the same Neon / Google OAuth / Netlify infrastructure as the previous v1.1 inventory product (which has been retired).

**Where we are:** Brainstorming complete. Full design spec committed. Implementation has **not started**. The repo still contains the old v1.1 code, untouched.

**Next step:** Invoke the `superpowers:writing-plans` skill against the spec to produce a step-by-step implementation plan. Then execute Phase 0 (the cleanup that wipes v1.1 from the working tree and the Neon database).

---

## The spec

**Read this before doing anything else:** `docs/superpowers/specs/2026-05-26-ams-module-design.md` (committed as `add8f09`, ~1000 lines, 17 sections).

It is the single source of truth for v2. Every architectural, data-model, UI, config, and phase decision is captured there. The user has approved it as-is.

If anything below contradicts the spec, the spec wins.

---

## What v2 is, in one paragraph

An admin-only tool where the admin (you, the user — `theexsolenterprise@gmail.com`) onboards **Clients** (businesses). Each Client picks a **business type** from 6 hardcoded templates (Shop, Store, Restaurant, Hotel, Clinic, Hospital). On Add Client, the system creates a **dedicated Postgres schema** for that client (`client_<32hex>`) with one table per role in the template (Hospital → `directors`, `doctors`, `nurses`, `staff`, `patients`). Each role table has a shared core (name, email, phone, notes) PLUS per-role custom columns (Doctor → specialty, license, years_practising; Patient → DOB, blood type, allergies, etc.). Admins manage users in each bucket via a sidebar/accordion UI with a dark-gray / off-white palette. Singleton roles (e.g., Owner) are enforced at UI, API, and DB layers.

The two modules built in this round are:
1. **Login Module** — Google OAuth + email/password, jose JWT, HttpOnly cookie. Admins only.
2. **AMS Module** — everything described above.

Future modules (Bookings, non-admin sign-in, etc.) are explicit non-goals for v2.

---

## Locked-in stack

| Layer | Choice |
|---|---|
| Frontend | Vite + React + TypeScript, `react-router-dom` v7, plain CSS (no Tailwind, no UI library) |
| Backend | Netlify Functions v2 + `@neondatabase/serverless` (same as v1.1 for what works) |
| Auth | `jose` (JWT) + `@node-rs/argon2` (passwords) + `google-auth-library` (Google ID tokens) |
| DB | Neon Postgres, **per-client schema** model (NOT a single users table — see spec §8) |
| Templates | Hardcoded TS objects (`netlify/functions/_shared/templates.ts`), version-tracked, reconcile via deploy script |

---

## Infrastructure that is preserved (do NOT recreate)

These are the same as v1.1 — the new app reuses them by design:

| Resource | Identifier / Notes |
|---|---|
| Neon project | Same project; **dev** and **prod** branches both still exist. Phase 0 wipes the tables in BOTH. The branches themselves stay. |
| Google OAuth client | Same OAuth client ID under `theexsolenterprise@gmail.com`'s Google project. `GOOGLE_OAUTH_CLIENT_ID` env var carries through. |
| Netlify site | `exsoldatacollectionapp.netlify.app`. Same site, same deploy history continues from `main`. |
| Git repo | Same. Tag `v1.1-final` will be created in Phase 0 to preserve v1.1 before the wipe. |
| Bootstrap admin email | `theexsolenterprise@gmail.com` (re-used; the new schema seeds it in Phase 2 with `is_bootstrap = true`). |

---

## What needs to change at infra level (Phase 0)

1. **Tag v1.1:** `git tag v1.1-final && git push origin v1.1-final`.
2. **Wipe the working tree:** delete `src/`, `netlify/functions/`, `db/migrations/`, `tests/`, `spec/`, `references/`, `scripts/`, `public/assets/`, `README.md`, `CONTEXT.md`, `docs/prd-v1.md`, `docs/handoff.md` (this file), `docs/adr/` (the v1.1 ADRs).
3. **Drop all tables** in Neon dev branch AND prod branch. (Branches stay; only schemas inside them are dropped.)
4. **Rewrite** `.env`, `package.json`, `netlify.toml`, `tsconfig.json` per spec §11.
5. **Add** to Netlify env: `SECRETS_SCAN_OMIT_KEYS=GOOGLE_OAUTH_CLIENT_ID` (lesson from v1.1's `dfc50a1` build failure — see auto-memory).
6. **Generate a fresh** `JWT_SIGNING_SECRET` (v1.1's secret is invalidated by the wipe).
7. **First commit** on the cleared tree: `chore: wipe v1.1, scaffold for v2 AMS`.

The spec's Phase 0 has the full ordered list. Do not improvise — follow it.

---

## Phase plan (high-level — full detail in spec §13)

| Phase | What ships | Estimate |
|---|---|---|
| 0 | Cleanup + tag v1.1-final | < 1 hr |
| 1 | Scaffold (package.json, vite, tsconfig, empty App.tsx) | 1 hr |
| 2 | Public schema migrations + bootstrap admin | 2 hr |
| 3 | Login Module (auth functions + LoginPage) | 1 day |
| 4 | AMS shell (sidebar, palette, empty dashboard) | 0.5 day |
| 5 | Templates + DDL generator + Bucket abstraction (no HTTP yet) | 2 days |
| 6 | Clients CRUD (Add/Delete Client → real schema ops) | 1 day |
| 7 | Bucket CRUD (dynamic forms per role.columns) | 2 days |
| 8 | Admin team management | 0.5 day |
| 9 | ClientDashboard placeholder + seed dummy clients | 0.5 day |
| 10 | Reconcile + ADRs + README | 1 day |
| 11 | Deploy preview smoke test | 0.5 day |
| 12 | Promote to prod | 0.5 day |

**Total: ~10–11 working days.**

---

## Critical context for a fresh Claude

1. **Do not start coding without an implementation plan.** The next step is `superpowers:writing-plans` against the spec, NOT going straight to Phase 0. The user has been explicit about following the brainstorming → plan → build workflow.
2. **The repo on disk is still v1.1.** Until Phase 0 runs, every file you see (other than the spec) is the old product. Do not mix v1.1 code patterns into v2 work — the v2 architecture is meaningfully different (e.g., per-client schemas, dynamic DDL, no RLS, React frontend).
3. **The user has approved the spec as-is.** Do not re-open settled decisions unless the user reopens them.
4. **The user builds modularly.** Don't try to scope-creep additional features (Bookings, non-admin sign-in, file attachments, etc.) into AMS v1. Those are deferred by design.
5. **The 3 dummy clients are part of v1 scope.** Joe's Hardware (shop), Bistro Verde (restaurant), St Mercy Hospital (hospital). Populated in Phase 9 with realistic seed data.

---

## Auto-memory pointers (still relevant)

These v1.1-era lessons carry forward — see `~/.claude/projects/.../memory/`:

- **`feedback_netlify_routing.md`** — don't put literal sub-paths under `:param` routes. v2 sidesteps this entirely by using query-string IDs (no `:param` in URLs at all).
- **`feedback_migration_before_deploy.md`** — dev/prod Neon branches are separate; always run `npm run migrate` against prod URL BEFORE promoting code that depends on a new migration. Phase 12 of the spec calls this out explicitly.

---

## File pointers

| File | Purpose |
|---|---|
| `docs/superpowers/specs/2026-05-26-ams-module-design.md` | The spec (single source of truth) |
| `docs/handoff.md` | This file (will be deleted in Phase 0) |
| `docs/adr/` | Old v1.1 ADRs (will be deleted in Phase 0; new ADRs 001–003 created in Phase 10) |
| `CONTEXT.md` | Old v1.1 glossary (will be deleted in Phase 0; new domain glossary written if needed during build) |
| `.env` | Currently v1.1 values; rewritten in Phase 0 |

---

## If the user asks "what now?"

Answer: invoke `superpowers:writing-plans` against `docs/superpowers/specs/2026-05-26-ams-module-design.md`. That skill will produce a detailed implementation plan with atomic tasks, review checkpoints, and (likely) a recommendation to work in a git worktree. After the user approves the plan, start with Phase 0.

Nothing in the working tree changes until the user approves the implementation plan.

---

*Spec approved 2026-05-26. Implementation pending plan-writing.*
