# ExSol Data Collection App

Multi-tenant SaaS for collecting product and stock data from Clients (businesses), so the data can be prepared for marketplace catalogs and consumed by downstream systems (future Internal Website / ERP, custom ecommerce, booking / catalog sites).

ExSol is the **hub** in a hub-and-spoke topology — the source of truth for product data. External marketplaces (Amazon, Flipkart, Meta, WhatsApp Business, Swiggy, Zomato, etc.) are *export targets*, not live integrations.

**Status:** Phase 4 of 5 complete. Auth, multi-tenant isolation, product CRUD, stock ledger, and admin impersonation all working on localhost. File storage (Drive), image upload, exports, and backups are Phase 5.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML / CSS / TypeScript on Netlify (static) |
| Backend | Netlify Functions in TypeScript |
| Database | Neon Postgres with Row-Level Security |
| File storage | Google Drive (designed; wired in Phase 5) |
| Auth | Google Sign-In via `google-auth-library` + email/password fallback (Argon2id) |
| Sessions | HS256 JWT in HTTP-only cookies, 15-min access + 30-day refresh rotation |
| Tests | Vitest |

Full rationale in [`docs/adr/0001-stack.md`](docs/adr/0001-stack.md).

---

## Quick start

Prerequisites: Node 20+, npm, a Neon project, a Google Cloud OAuth Client ID.

```bash
git clone https://github.com/FaraazArmaan/exsol-data-collection-app.git
cd exsol-data-collection-app
npm install
cp .env.example .env
# Edit .env — see docs/handoff.md for which vars need real values
npm run migrate              # apply 8 SQL migrations to Neon
npm run bootstrap:admin      # create the admin user row
npm run dev                  # netlify dev on localhost:8888
```

Open http://localhost:8888 and sign in. The latest session block at the top of [`docs/handoff.md`](docs/handoff.md) walks through every step in detail, including how to set up Neon and Google OAuth from scratch.

---

## Repo layout

```
.
├── public/                  Static frontend (HTML, CSS, ES modules)
│   ├── login.html
│   ├── admin.html              Admin: Client list + onboarding
│   ├── admin-workspace.html    Admin: per-Client detail + impersonation
│   ├── workspace.html          Product Dashboard
│   ├── product-edit.html       Product editor (Core + marketplace tabs + Stock)
│   ├── me.html                 Primary/Manager/Storekeeper landing
│   └── assets/                 CSS + small JS helpers
│
├── netlify/functions/       HTTP endpoints (TypeScript)
│   ├── auth-google.ts          POST /api/auth/google
│   ├── auth-email-login.ts     POST /api/auth/email/login
│   ├── auth-refresh.ts         POST /api/auth/refresh
│   ├── auth-logout.ts          POST /api/auth/logout
│   ├── me.ts                   GET  /api/me
│   ├── config.ts               GET  /api/config
│   ├── admin-workspaces.ts          GET/POST /api/admin/workspaces
│   ├── admin-workspace-detail.ts    GET      /api/admin/workspaces/:id
│   ├── admin-workspace-unlock.ts    POST     /api/admin/workspaces/:id/unlock
│   ├── admin-workspace-rotate-key.ts POST    /api/admin/workspaces/:id/rotate-key
│   ├── admin-impersonate.ts         GET/POST/DELETE /api/admin/impersonate
│   ├── workspace-products.ts        GET/POST /api/workspaces/:wsid/products
│   ├── workspace-product-detail.ts  GET/PATCH/DELETE .../products/:pid
│   ├── workspace-product-overlay.ts PUT      .../products/:pid/marketplaces/:mp
│   ├── workspace-stock-movements.ts POST     .../stock/movements
│   └── workspace-stock-views.ts     GET      .../stock/views
│
├── src/lib/                 Deep modules (testable core)
│   ├── tenancy.ts              Module 1 — Postgres RLS context wrappers
│   ├── permissions.ts          Module 2 — Role matrix (table-driven)
│   ├── auth-verifier.ts        Module 3 — Google + email/pw verify
│   ├── session-manager.ts      Module 4 — JWT issue/verify/refresh
│   ├── workspace-unlock-manager.ts Module 5 — per-Client key gate
│   ├── impersonation-manager.ts    Module 6 — god-mode sessions
│   ├── audit-log-writer.ts     Module 7 — diff-aware audit events
│   ├── stock-ledger.ts         Module 8 — ledger movements + recount
│   ├── product-service.ts      Module 13 — CRUD + overlays + stock views
│   ├── workspace-actor.ts      Composition helper
│   ├── cookies.ts, env.ts, db.ts, http.ts, types.ts
│
├── db/migrations/           Numbered SQL files (run by scripts/migrate.ts)
├── scripts/                 migrate.ts, bootstrap-admin.ts
├── tests/                   Vitest suites (DB-gated tests skip without TEST_DATABASE_URL)
├── docs/                    PRD, ADRs, glossary, grilling log, handoff
└── CONTEXT.md, README.md, package.json, tsconfig.json, netlify.toml
```

---

## Documentation

Read in this order:

1. [`CONTEXT.md`](CONTEXT.md) — canonical glossary (Admin, Workspace, Primary, Manager, Storekeeper, Product, Stock Movement, etc.)
2. [`docs/prd-v1.md`](docs/prd-v1.md) — 108 user stories, schema sketch, API surface, test plan, what's explicitly out of v1 scope
3. [`docs/adr/`](docs/adr/) — five Architecture Decision Records with alternatives considered
   - `0001-stack.md` — Netlify + Neon + TypeScript + Drive
   - `0002-authentication.md` — Google + email/pw fallback
   - `0003-tenancy-and-impersonation.md` — RLS, roles, god-mode impersonation
   - `0004-product-and-stock-model.md` — Core + Overlay schema, stock-as-ledger, exports
   - `0005-files-backups-audit-deployment.md` — Drive layout, backups, audit, GitHub flow
4. [`docs/grilling-log.md`](docs/grilling-log.md) — every design Q&A in order, including the reframes that changed the plan
5. [`docs/handoff.md`](docs/handoff.md) — session log; the top block is the current state and tomorrow's plan

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start Netlify dev server on `localhost:8888` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest run-once |
| `npm run test:watch` | Vitest watch mode |
| `npm run migrate` | Apply pending DB migrations |
| `npm run migrate:status` | Show which migrations are applied vs pending |
| `npm run bootstrap:admin` | Create or promote an admin user from `ADMIN_GOOGLE_EMAIL` (+ optional `ADMIN_PASSWORD`) |

---

## Test status

```
Test Files  1 passed | 5 skipped (6)
     Tests  24 passed | 34 skipped (58)
```

The 34 skipped tests need a Neon connection — set `TEST_DATABASE_URL` to a Neon dev branch (separate from `NEON_DATABASE_URL`) and re-run `npm test` to exercise the database-backed assertions (RLS isolation, ledger arithmetic, impersonation lifecycle, unlock lockout, audit diffs).

---

## What's NOT yet in v1

- Module 9 `driveClient`, Module 10 `imagePipeline` (image upload UI uses a placeholder thumbnail today).
- Module 11 `exportEngine` (XLSX / CSV / Meta-catalog CSV generation).
- Module 12 `backupEngine` (per-Client ZIP + system tar.gz nightly).
- File manager UI, exports tab, backups panel, audit log viewer UI.
- CSV bulk product import UI (backend accepts `source: 'csv'`; UI to come).
- Per-marketplace structured field forms (currently freeform JSON per marketplace).
- Resend email + invite-link acceptance flow.
- Live integrations with marketplaces (deliberately out of v1 — see ADR 0004).
- Marketing automation (Canva ads on low/dead stock — deferred to phase 2).
- Native mobile apps (web-only; responsive layout works on mobile browsers).

See [`docs/prd-v1.md`](docs/prd-v1.md) §"Out of Scope" for the full list.

---

## License

Not yet set. The repo is public for transparency and review; treat it as proprietary work-in-progress until a license file lands.
