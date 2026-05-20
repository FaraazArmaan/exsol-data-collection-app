# ExSol Data Collection App

**A multi-tenant SaaS for product and stock data collection, designed as the source-of-truth hub in a downstream-system topology.**

---

## Abstract

ExSol Data Collection is a multi-tenant web application that lets a single operator (Admin) onboard businesses (Clients) and provision them isolated workspaces for collaborative product and stock-data maintenance. Each workspace supports role-scoped team members (Primary, Manager, Storekeeper), an append-only stock ledger, and per-marketplace JSONB overlays for catalog field heterogeneity. Tenant isolation is enforced server-side via Postgres Row-Level Security; admin access to client data is gated by a per-client access key plus auditable, time-boxed impersonation. The system is delivered as a static frontend on Netlify, TypeScript Netlify Functions, a Neon Postgres database, and Netlify Blobs for file storage. This document describes the problem, the design, and the current implementation as of 2026-05-20.

**Status.** Phase 5 partial. Auth, multi-tenant isolation, product CRUD, stock ledger, admin onboarding, god-mode impersonation, and product image storage (on Netlify Blobs) are operational on localhost. Exports, backups, and production deployment remain. Target production release: Friday 2026-05-22.

---

## 1. Introduction

Small- and mid-sized businesses (SMBs) in India and similar markets prepare product catalogs for online sale across multiple platforms: Amazon, Flipkart, Meta Catalog, WhatsApp Business, Swiggy, Zomato, Rakuten, AliExpress, and bespoke storefronts. In current practice this is done by hand in spreadsheets that are manually re-shaped for each marketplace's required schema. Stock counts go stale because no shared multi-user record exists for storekeepers to log sales, receipts, and damages. Marketplace uploads are error-prone and brittle.

This work presents ExSol Data Collection, a hub-and-spoke web application addressing those pains by serving as the canonical source of truth for product and stock data. The application is consumed downstream by an internal ERP (forthcoming) which then fans out to consumer-facing applications (booking, catalog, ecommerce). External marketplaces are export targets, not live integrations — a deliberate v1 scope decision documented in [`docs/adr/0004-product-and-stock-model.md`](docs/adr/0004-product-and-stock-model.md).

The contributions of this implementation are: (i) a Postgres-RLS-enforced multi-tenant data model with three context flavors (workspace, admin, user-only) supporting both straightforward isolation and well-audited cross-tenant operations; (ii) a Core + Marketplace-Overlay product schema that supports heterogeneous catalog fields without entity-attribute-value pitfalls or unmaintainable wide tables; (iii) a stock-as-ledger model where the current count is derived from the sum of an append-only movement log; (iv) a god-mode impersonation mechanism with required reason, time-box, persistent banner, and dual-attribution audit trail, exposing admin interventions as a customer-facing feature rather than an internal-only tool.

---

## 2. Background

### 2.1 Tenant isolation in shared-database SaaS

Three common patterns exist for tenant isolation in SaaS: shared database with a `tenant_id` column on every row; separate Postgres schema per tenant; separate database per tenant. We adopt the shared-database pattern, reinforced by Postgres Row-Level Security (RLS) policies that scope every query at the database engine rather than relying on application code to remember `WHERE tenant_id = ?`. RLS enables the strongest correctness guarantee available without paying the operational cost of multiple databases. See [`docs/adr/0003-tenancy-and-impersonation.md`](docs/adr/0003-tenancy-and-impersonation.md) for the alternatives considered.

### 2.2 The hub-and-spoke topology

The application is the *hub* in a topology where downstream systems consume from it. This contrasts with the common SaaS pattern of integrating directly with external services (Shopify, Amazon SP-API, Meta Commerce). The decision was driven by the operator's planned product stack: ExSol's output feeds an internal website (in development) which then publishes to consumer surfaces. Live marketplace integrations are deferred to a later phase because the integration topology, not v1, is the right place for them.

### 2.3 Stock-as-ledger

A naive stock model stores the count in a single column and overwrites it on each change. This loses history, races on concurrent writers, and breaks reconciliation. The ledger pattern (long established in event-sourcing literature) stores every change as an immutable row and derives the current count via `SUM(delta)`. We adopt it both for correctness and for downstream auditability.

---

## 3. Architecture

### 3.1 Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│              ExSol Data Collection (this app, the hub)              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ feeds
                           ▼
                  Internal Website / ERP (next hop, in development)
                           │
                           ├──→ Booking site
                           ├──→ Catalog site
                           ├──→ Custom ecommerce site
                           └──→ Marketplace uploads
                                  (Meta Catalog, WhatsApp Business,
                                   Amazon, Flipkart, etc.)
```

### 3.2 Component diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  Browser (vanilla HTML/CSS/JS)                                     │
│  - public/login.html        - public/admin.html                    │
│  - public/workspace.html    - public/product-edit.html             │
│  - public/me.html           - public/admin-workspace.html          │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ HTTPS, HTTP-only cookies
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│  Netlify Functions (TypeScript, 26s timeout)                       │
│  - auth-google / email-login / refresh / logout / me / config      │
│  - admin-workspaces / admin-workspace-* / admin-impersonate        │
│  - workspace-products / workspace-product-detail / overlay         │
│  - workspace-stock-movements / workspace-stock-views               │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ uses
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│  src/lib (13 deep modules — small interfaces, complex bodies)      │
│  - tenancyContext       - permissionPolicy                         │
│  - authVerifier         - sessionManager                           │
│  - workspaceUnlockMgr   - impersonationManager                     │
│  - auditLogWriter       - stockLedger                              │
│  - productService       - workspace-actor (composition helper)     │
│  - blobStorage          - imagePipeline                            │
│  - exportEngine*        - backupEngine*       (* in development)   │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ talks to
                       ▼
┌──────────────────────────────────┐    ┌─────────────────────────────┐
│  Neon Postgres                   │    │  Netlify Blobs              │
│  - 9 migrations, RLS-enforced    │    │  - product-images store     │
│  - Pool via WebSocket            │    │  - opaque <wsid_pid_uuid>   │
│  - GUC-based context             │    │    keys, multipart upload   │
└──────────────────────────────────┘    └─────────────────────────────┘
```

### 3.3 The actor context

Every authenticated request resolves to an `ActorContext` object describing the real actor, the workspace role they hold (or null for system admin), and any active impersonation:

```typescript
type ActorContext = {
  realActorId: string;
  realRole: 'admin' | null;
  onBehalfOfId: string | null;
  workspaceRole: 'primary' | 'manager' | 'storekeeper' | null;
  workspaceId: string | null;
  isImpersonating: boolean;
  impersonationReason: string | null;
};
```

The `permissionPolicy.can(actor, action, resource)` function is the single point of access control for every endpoint. Combined with Postgres RLS at the database layer, this gives two independent enforcement points that must both grant the operation.

---

## 4. Implementation

### 4.1 Stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML5 + CSS + ES modules (no framework) |
| Static hosting | Netlify CDN |
| Backend | Netlify Functions, TypeScript |
| Database | Neon Postgres with Row-Level Security |
| File storage | Netlify Blobs (`product-images` store; multipart upload, ≤5 MB) |
| Primary auth | Google Identity Services |
| Fallback auth | Email + Argon2id-hashed password |
| Session tokens | HS256 JWT, 15-minute access + 30-day refresh, HTTP-only cookies |
| Tests | Vitest |

### 4.2 Deep modules

Each module presents a small, stable surface that hides significant body complexity. The discipline draws from Ousterhout's *A Philosophy of Software Design*. The thirteen modules are listed in [`spec/index.html`](spec/index.html) §6.

### 4.3 Data model

Eight numbered SQL migrations under `db/migrations/` define the schema. Notable patterns:

- **Workspace-scoped tables** carry `workspace_id` and have RLS policies that reference the GUC `app.current_workspace_id`. See `db/migrations/007_rls_policies.sql`.
- **The `is_member_of()` `SECURITY DEFINER` function** in `db/migrations/008_user_context_policies.sql` lets a user see their own memberships without selecting a workspace context first.
- **The `stock_movements_apply_delta` trigger** maintains `products.stock_count` as a materialized view of the ledger sum.

### 4.4 Authentication

Google Identity Services issues an ID token that the backend verifies via `google-auth-library` (audience-checked against the configured OAuth Client ID). The verified email is matched against the `users` table; on first sign-in the Google `sub` is linked. Email + password is a fallback for users without Gmail. Passwords are hashed with Argon2id (`@node-rs/argon2`). Sessions are signed JWTs in HTTP-only `SameSite=Lax` cookies; the refresh token is rotated on each refresh and revoked on sign-out.

### 4.5 Admin access gate

Each workspace has a 12-character access key generated at onboarding and stored as an Argon2id hash. Admin must enter the key in addition to being signed in before viewing any of that workspace's data. A successful entry grants a 15-minute auto-extending unlock claim. Five failed attempts in ten minutes triggers a 1-hour lockout with an email alert to the Primary.

### 4.6 Impersonation

Admin, after unlocking a workspace, can impersonate any member with a written reason of at least three characters. The impersonation session lasts up to 30 minutes, displays a persistent red banner site-wide, and records every action in the audit log with the real actor (Admin) and the on-behalf-of user separated. Business-data writes attribute to the impersonated user; audit-log entries attribute to both. This makes admin interventions a customer-visible feature surfaced via the "Admin Activity" tab rather than an opaque internal capability.

---

## 5. Evaluation

### 5.1 Test coverage

| Module | Tests | Status |
|---|---|---|
| `permissionPolicy` | 24 | Pure TS, all passing |
| `tenancyContext` | 6 | DB-gated |
| `auditLogWriter` | 5 | DB-gated |
| `workspaceUnlockManager` | 7 | DB-gated |
| `impersonationManager` | 7 | DB-gated |
| `stockLedger` | 9 | DB-gated |
| **Total** | **58** | 24 passing, 34 require `TEST_DATABASE_URL` |

DB-gated tests skip cleanly when a test database isn't configured. To run them, point `TEST_DATABASE_URL` at a Neon dev branch and re-run `npm test`. The `permissionPolicy` suite is table-driven and exercises every (role × action × resource) combination plus god-mode impersonation rules.

### 5.2 What works end-to-end on localhost

- Google sign-in landing the admin on the admin dashboard.
- Email + password fallback for non-Google admin accounts.
- Onboarding a Client (workspace + Primary user + access key).
- Per-Client unlock with rate-limited failure handling.
- God-mode impersonation start/end with banner.
- Product CRUD and marketplace overlay editing.
- Stock movement recording (delta and absolute-recount modes).

### 5.3 Known limitations

- Image upload UI is a placeholder (Phase 5).
- Marketplace overlays accept freeform JSON (structured per-marketplace forms come in v1.1).
- No exports yet (Phase 5).
- No backups yet (Phase 5).
- No audit log viewer UI yet (data captured; viewer in Phase 5).
- Not yet deployed to a public URL.

---

## 6. Future work

The deferred items above plus, in order of expected priority post-v1:

1. **Live marketplace integrations** — outbound stock-availability push to Meta and WhatsApp Business catalogs; inbound order webhooks from the custom ecommerce site to decrement stock automatically.
2. **Forecasting and analytics** — dead-stock detection beyond the threshold model, demand prediction, smart reorder points. The deferred Python analytics worker (see ADR 0001) is the intended home for these.
3. **Marketing automation** — Canva-based ad generation triggered by low-stock or dead-stock signals.
4. **Real-time collaboration** — live cursors and merged edits on the product editor.
5. **Multi-language UI** — currently English-only.
6. **Mobile apps** — currently a responsive web app only.

A complete out-of-scope list is in [`docs/prd-v1.md`](docs/prd-v1.md) §"Out of Scope".

---

## 7. References

Curated external resources informing this implementation are catalogued in [`references/index.md`](references/index.md), organized by category (UI/UX, authentication, multi-tenancy, marketplace specs, infrastructure, library documentation, patterns, India-specific).

In-repository documents:

- [`spec/index.html`](spec/index.html) — Canonical end-to-end specification (master document and addenda).
- [`CONTEXT.md`](CONTEXT.md) — Glossary of domain terms.
- [`docs/prd-v1.md`](docs/prd-v1.md) — Product requirements document with 108 user stories and out-of-scope list.
- [`docs/adr/`](docs/adr/) — Architecture Decision Records 0001–0005 with alternatives considered.
- [`docs/grilling-log.md`](docs/grilling-log.md) — Chronological design Q&A log.
- [`docs/handoff.md`](docs/handoff.md) — Session log with the latest state at the top.

---

## Quick start

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

| Command | Purpose |
|---|---|
| `npm run dev` | Start Netlify dev server on `localhost:8888` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest run-once |
| `npm run test:watch` | Vitest watch mode |
| `npm run migrate` | Apply pending DB migrations |
| `npm run migrate:status` | Show which migrations are applied vs pending |
| `npm run bootstrap:admin` | Create or promote an admin user from `ADMIN_GOOGLE_EMAIL` |

---

## License

[MIT](LICENSE) © 2026 Faraaz Armaan.
