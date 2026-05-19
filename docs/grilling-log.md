# Grilling Log — ExSol Data Collection App Architecture

- **Date:** 2026-05-19
- **Format:** Each decision shows the *insight* given before the question, the *options* offered, the *recommendation*, your *answer*, and the *resulting decision* (with a pointer to where it's filed).
- **Purpose:** Reference artifact for future learning. Captures not just *what* was decided, but the trade-offs and the reasoning behind each call.

---

## Original brief — what we started from

You asked for a SaaS-style data-collection web app to onboard Clients, let them manage products + stock + team members, export to marketplaces, and let Admin (you) supervise everything. Original stack request: **HTML/JS/CSS frontend + Python backend + MySQL DB on Netlify**, with auth via Google/Apple/SMS/Email, files in GitHub, multi-marketplace product fields, per-Client backups, full-system backups, admin impersonation, and a "Client-specific Key-Password" gate.

Three load-bearing issues in the original brief surfaced during grilling and were resolved:

1. **MySQL doesn't run on Netlify.** Netlify hosts static files + short-lived serverless functions; it has no DB service.
2. **Python on Netlify is a beta runtime with a 10-second hard timeout.** Bulk exports and ZIP backups would have failed silently at scale.
3. **Live integrations with WA/Meta/Shopify in v1 were unnecessary.** You later clarified the app is the *hub* in a hub-and-spoke topology — consumer sites are two hops downstream.

---

## Decision 1 — Where the backend, DB, and files live

### Insight
- Netlify cannot host MySQL — it's static-frontend + serverless functions only, no DB.
- Python on Netlify is beta with a 10-second timeout — fights every feature on your list.
- You actually have two hosting questions: where does the *frontend* live, and where does the *backend + DB + files* live?

### Options offered
1. Railway / Render (Recommended) — Netlify for frontend, Railway/Render for Python + MySQL + files
2. Supabase + Netlify Functions
3. Self-host on a VPS
4. AWS (RDS + Lambda + S3)

### Your answer
> "What about hosting Backend on Neon Netlify"

### Follow-up
Clarified that Neon is Postgres (not MySQL), Neon + Netlify still has gaps for Python and file storage. Re-asked with Netlify as the frontend lock-in.

### Final answer (after re-ask)
> "Netlify is a must. What about SQL using GDrive? What are my options"

Clarified that Google Drive can't host SQL (it's file storage, not a DB server), but it can legitimately host *files*. Re-asked the DB + file question with that in mind.

> **Neon (DB) + GDrive (files) (Recommended)**

### Decision
- Frontend: **Netlify** (static HTML/JS/CSS)
- Database: **Neon Postgres** (replaces MySQL)
- File storage: **Google Drive** (via Drive API, on your existing 15 GB account)

### Filed in
`docs/adr/0001-stack.md`

---

## Decision 2 — Backend language

### Insight
- Netlify Functions is TypeScript-native (26-second timeout, mature SDK, full doc coverage).
- Python on Netlify is beta-only (10-second timeout, sparse examples).
- Nothing on your feature list specifically needs Python — every library has a mature TS equivalent.
- Python *would* shine later for ML / dead-stock analytics, but that's phase 2.

### Options offered
1. TypeScript only (Recommended)
2. **TypeScript now, add Python worker later** ← your choice
3. Python via Netlify beta runtime
4. Hybrid from day 1

### Your answer
> TypeScript now, add Python worker later

### Decision
- v1 backend: **TypeScript Netlify Functions**.
- Reserve a small Python service on Railway/Render for v2 analytics when needed.

### Filed in
`docs/adr/0001-stack.md`

---

## Decision 3 — Authentication strategy

### Insight
- Your original list (Google + Apple + SMS + Email + username/password, separately for clients and admin) is weeks of work and carries recurring cost.
- Auth providers (Supabase Auth, Clerk, Firebase Auth) absorb this pain.
- "Admin login separate from client login" is a UX choice; the cleanest model is one auth system with roles enforced server-side.

### Options offered
1. Supabase Auth (Recommended)
2. Clerk
3. Firebase Auth
4. Roll your own with Lucia + Twilio + Resend

### Your answer
> "Google Auth"

### Follow-up
Clarified what "Google Auth" most likely meant (Google Identity Services library directly, not a vendor). Re-asked to pin down exact scope.

### Final answer
> Google Sign-In + email+password fallback

### Decision
- Primary: **Google Sign-In via Google Identity Services (GIS)**.
- Fallback: **email + password** (Argon2id hashed) with email verification via Resend.
- Dropped: Apple ID, SMS OTP, separate admin login mechanism.
- Admin vs Client distinction lives in the DB, not in separate login pages.
- Sessions: signed JWT in HTTP-only cookie; 15-min access + 30-day refresh.
- Admin's Google account must have 2FA + an emergency recovery path before launch.

### Filed in
`docs/adr/0002-authentication.md`

---

## Decision 4 — Multi-tenancy model

### Insight
- Three patterns exist: shared DB + `tenant_id` + RLS (95% of SaaS), schema-per-tenant, DB-per-tenant.
- Postgres Row-Level Security is the safety net that makes shared-DB safe.
- Neon's free tier (0.5 GB shared) biases against DB-per-tenant (costs ~$19/mo per Client beyond ~3 clients).
- Admin impersonation is much easier in a shared-DB model.

### Options offered
1. **Shared DB + tenant_id + RLS (Recommended)** ← your choice
2. Schema-per-Client
3. Database-per-Client
4. Single DB, no tenancy (anti-pattern)

### Your answer
> Shared DB + tenant_id + RLS (Recommended)

### Decision
- Single Neon Postgres DB.
- Every tenant-scoped table has `workspace_id`.
- Postgres RLS policies enforce isolation: every request opens with `SET app.current_workspace_id = ...`.
- Admin path uses a `SECURITY DEFINER` function or separate `admin_role` to bypass RLS after per-Client key verification.

### Filed in
`docs/adr/0003-tenancy-and-impersonation.md`

---

## Decision 5 — Workspace role matrix

### Insight
- Most SMB product/stock SaaS converges on 2–4 roles per workspace.
- The most important boundary is "who can write stock counts" vs "who can write product definitions."
- Roles are easier to add than to remove — start small.

### Options offered
1. Primary + Storekeeper only (Recommended)
2. **Primary + Manager + Storekeeper** ← your choice
3. Primary + Manager + Storekeeper + Viewer
4. Fully custom per-Client roles

### Your answer (first attempt)
> "Where does the admin fit here?"

### Follow-up
Clarified that Admin is a **system-level** role that lives outside every Workspace — not a Workspace member. Drew the hub-and-spoke diagram showing Admin sits above all Workspaces. Re-asked.

### Final answer
> Primary + Manager + Storekeeper

### Decision
- System: **Admin** (you).
- Per Workspace: **Primary** (full control), **Manager** (no team/settings/billing), **Storekeeper** (stock only).
- A user can hold different roles in different Workspaces (many-to-many via `workspace_memberships`).

### Filed in
`docs/adr/0003-tenancy-and-impersonation.md`, `CONTEXT.md` (Roles section)

---

## Decision 6 — "Client-specific Key-Password" interpretation

### Insight
- The phrase was ambiguous; it could mean (a) Admin-access gate, (b) encryption-at-rest key, or (c) just a label.
- Each interpretation has wildly different cost: (a) is 1 day, (b) is 2–3 weeks + permanent query tax, (c) is trivial.
- Most SMB SaaS doesn't have this concept at all — the fact that you specified it suggests trust/transparency motivation, which (a) delivers cheaply.

### Options offered
1. **Admin-access gate per Client (Recommended)** ← your choice
2. Encryption-at-rest key per Client
3. Just a label / contact verification code
4. Drop the concept entirely

### Your answer
> Admin-access gate per Client (Recommended)

### Decision
- Each Workspace has a 12-char random `admin_access_key`, set at onboarding, shown once to the Primary, rotatable anytime.
- Stored as Argon2id hash.
- Admin must enter the key (in addition to being signed in) before viewing or impersonating in that Workspace.
- Success grants a 15-min unlock claim; auto-extends on activity.
- Failed attempts: 5 strikes in 10 minutes → 1-hour lockout + email alert to Primary.

### Filed in
`docs/adr/0003-tenancy-and-impersonation.md`, `CONTEXT.md` (Per-Client gate)

---

## Decision 7 — Admin impersonation mechanics

### Insight
- "With all the privileges of a primary user" has two readings: capped to the user's envelope, or augmented with admin powers.
- Industry standard is "act as" (capped) mode — Stripe, Linear, Salesforce, Notion, Intercom.
- God mode is easier for support but blurs audit.
- The banner + reason + time-box pattern is what makes impersonation auditable and usable.

### Options offered
1. 'Act as' capped + dual attribution (Recommended)
2. 'Act as' capped + Admin keeps backup/export powers
3. **'God mode' — Admin keeps all admin powers** ← your choice
4. Only sign-in-as-Primary; no impersonation of Manager/Storekeeper

### Your answer
> 'God mode' — Admin keeps all admin powers during impersonation

### Caveat I flagged
Under god mode, the audit log becomes the only place a Client sees that Admin acted on their workspace (business data UI shows the impersonated user as the actor). The audit log is therefore a *product feature*, not an internal tool — surfaced as "Admin Activity" tab. Confirmation prompts still fire on destructive actions even in god mode.

### Decision
- **God mode** with mitigations: required written reason, persistent banner, 30-min auto-expire, extra confirmation on destructive actions, full audit-log capture, Admin Activity tab.
- Business data attribution: shows the **impersonated user**; audit log records the **real actor** with the reason.
- Reversible to capped mode in v2 — schema doesn't change.

### Filed in
`docs/adr/0003-tenancy-and-impersonation.md`, `CONTEXT.md` (Impersonation)

---

## Decision 8 — Product schema strategy

### Insight
- Marketplace field counts differ wildly: Amazon ~200, Flipkart ~120, Meta ~30, WA ~10. Swiggy/Zomato are restaurant-shaped and don't fit the SKU model.
- The standard pattern is Core + Overlay (canonical fields + per-marketplace JSONB).
- Postgres JSONB lets you add new marketplaces with code changes only, no schema migration.
- Swiggy/Zomato can be supported but only if you introduce a `product_type` switch (physical_goods vs food_item).

### Options offered
1. Core + JSONB overlays, physical goods only in v1 (Recommended; Swiggy/Zomato deferred to v2)
2. **Same as above but include Swiggy/Zomato in v1 as a 'food product type'** ← your choice
3. Single mega-table flattened
4. EAV pattern

### Your answer
> Same as above but include Swiggy/Zomato in v1 as a 'food product type'

### Decision
- Canonical `products` table with the core fields (SKU, name, price, stock, dimensions, images, GST/HSN, etc.).
- `product_type` enum: `physical_goods` | `food_item`. UI conditionally shows menu fields (prep_time, modifiers, dietary_tags, spice_level) for food.
- Marketplace overlays in `product_marketplace_fields (product_id, marketplace, fields jsonb, enabled, last_synced)`.
- v1 marketplaces: amazon, flipkart, meta, wa, rakuten, aliexpress, swiggy, zomato.

### Filed in
`docs/adr/0004-product-and-stock-model.md`, `CONTEXT.md` (Catalog)

---

## Decision 9 — Image upload + serving pipeline

### Insight
- Google Drive is storage, not a CDN. Direct Drive URLs hit rate limits when a dashboard loads 100 product thumbnails.
- Fix: upload directly from browser to Drive via a signed resumable session URL (bypasses Netlify's 6 MB cap), then serve thumbnails through Netlify's Image CDN with edge caching.
- Drive becomes invisible plumbing — Clients never see Drive URLs.

### Options offered
1. **Direct-to-Drive upload + Netlify Image CDN proxy (Recommended)** ← your choice
2. Same upload but serve live from Drive (rate-limit risk)
3. Move image storage to Cloudflare R2
4. Base64 thumbnails in Postgres + originals in Drive

### Your answer (first attempt)
> "The question is simple. Will option 1 allow the image to be viewed for the products, or will it appear as a link?"

### Follow-up
Clarified that images render as **inline pictures**, not links — `<img>` tags resolve to `/.netlify/images?...` URLs on your domain; Drive is invisible to the Client. Showed before/after visualization.

### Final answer
> Direct-to-Drive upload + Netlify Image CDN proxy (Recommended)

### Decision
- Upload flow: browser → resumable Drive URL (got from Netlify Function) → Drive directly.
- Serve flow: `<img src="/.netlify/images?url=/api/img/<id>&w=200">` → Netlify Image CDN → cached at edge for 30 days.
- Limits: max 5 images/product (v1), 10 MB each, jpeg/png/webp/avif.
- Migration path to Cloudflare R2 is mechanical if Drive limits ever bite (not in v1).

### Filed in
`docs/adr/0005-files-backups-audit-deployment.md`

---

## Decision 10 — File manager scope

### Insight
- "File manager" could mean Admin-only, per-Client only, or both — different scopes.
- A breadcrumb-style file manager with full Dropbox features is ~4 weeks of frontend work. Worth doing only if it's a major feature.
- Drive's folder structure naturally hosts a per-Workspace file manager.

### Options offered
1. **Per-Workspace + Admin view, simple CRUD only (Recommended)** ← your choice
2. Admin-only file manager
3. Full Dropbox-style (drag-drop, multi-select, trash, sharing, versioning)
4. Skip the file manager, use Drive directly

### Your answer
> Per-Workspace + Admin view, simple CRUD only (Recommended)

### Decision
- Per-Workspace file manager + Admin browses across all Workspaces with the same UI.
- v1 ops: browse, upload, download, rename, delete, create folder. **No** drag-drop, multi-select, trash, sharing, versioning.
- Permissions: Primary/Manager full CRUD; Storekeeper read + upload only.
- Drive folder layout: `ExSol Data Collection/<Workspace>/{Products, Documents, Backups, Exports, Audit Archive}/`.

### Filed in
`docs/adr/0005-files-backups-audit-deployment.md`, `CONTEXT.md` (Files & exports)

---

## Decision 11 — Export targets and format

### Insight
- "WA Business export" and "Meta export" mean Meta's exact catalog CSV schema (column names matter — Meta rejects misnamed columns).
- "Custom Ecommerce" was undefined — could mean generic XLSX, your future custom builder, or per-Client configurable export.
- Amazon flat-file is a heavy build (category-specific templates) — deferring is wise.

### Options offered (multi-select)
1. XLSX (all fields)
2. CSV (all fields)
3. Meta Catalog / WA Business CSV (Meta schema)
4. Amazon Flat-File feed

### Your answer
> "Keep XLSX and CSV as general options that work for everyone. Keep WA Business and Meta Specific options to ease the upload process to the catalog. As for 'Custom Ecommerce', this will be uploaded on the secondary system that makes Ecommerce websites based on the Product Data in the Data Collection App. The XLSX and CSV fields are good for this, the intent was to let you know that this will happen, so both the files should be comprehensive."

### Key reframe
"Custom Ecommerce" is not a third export target — it's a **downstream consumer**. The comprehensive XLSX/CSV are the contract between ExSol and your future custom ecom builder.

### Decision
- **XLSX (comprehensive)** — every core field + every enabled overlay flattened.
- **CSV (comprehensive)** — same content as XLSX.
- **Meta Catalog CSV** — Meta's exact schema, works for both Meta Commerce and WhatsApp Business.
- Amazon flat-file deferred to v2.

### Filed in
`docs/adr/0004-product-and-stock-model.md`

---

## Decision 12 — Export delivery (sync vs async)

### Insight
- Comprehensive XLSX with 8 overlays and 5,000 products is ~750k cells — takes 15–40s of CPU.
- Netlify Functions cap at 26s, so sync export breaks silently when a Client grows.
- Async-with-job-table delivers reliably at any scale and gives you "view past exports" for free.

### Options offered
1. **Hybrid: sync for small, async for large (Recommended)** ← your choice
2. Always async
3. Always sync (anti-pattern at scale)
4. Sync + explicit "large export" button

### Your answer
> Hybrid: sync for small, async for large (Recommended)

### Decision
- Backend estimates size: ≤ 500 products **or** ≤ 2 MB → sync (instant download); else async.
- Async path: job in `export_jobs` table → Netlify Scheduled Function picks it up → file lands in `<Workspace>/Exports/` → in-app toast notifies on completion.
- "Exports" tab in UI lists past exports for re-download.
- Filters at generation time: all, by category, by marketplace flag, by date range, by selection.

### Filed in
`docs/adr/0004-product-and-stock-model.md`

---

## Decision 13 — Stock sync model

### Insight
- WhatsApp Business has no quantitative stock — only `availability` enum.
- "Ecommerce Website" sync needs to know which platform (yours? Shopify? Woo?).
- Conflict resolution is the silent killer of multi-source stock systems.
- The fix is **stock-as-ledger**: every change is a row; current count is `SUM(deltas)`. No overwrites, no races.

### Options offered
1. Manual + CSV + generic webhook + WA/Meta push (Recommended)
2. Manual + CSV only
3. Above + Shopify + Woo adapters
4. Everything from start

### Your answer
> "To be honest, the data collection app really doesn't need to communicate with external platforms to display stock. What really matters is that it helps keep track for the custom Ecommerce Website that will use the data to run discounts as such 'Last 2 remaining!!'. If needed, it will do the same and connect to something like canva or such to create marketing ads when stock is low and needs to be pushed out for perishables."

### Key reframe — biggest of the session
ExSol is the **hub** in a hub-and-spoke architecture:
```
Data Collection App
       │
       ▼
Internal Website (future ERP)
       │
       ├──→ Booking Site
       ├──→ Catalog Site
       └──→ Ecom Site (where "Last 2 remaining" lives)
```
External marketplaces are not v1 concerns. Marketing automation (Canva, ad pushes) is phase 2. The Internal Website doesn't exist yet, so even internal integration is deferred.

### Re-confirmation
> "This is not a matter of importance currently. The process we plan is Data Coll. App > Internal Website > Branches into multiple things like Booking Site, Catalog Site, Ecom Site and so on depending on the products."

### Decision
- v1 inbound sources: **manual** (dashboard), **CSV** (bulk import), **recount** (Storekeeper observes shelf, system records delta).
- v1 outbound: **none**. ExSol is read by future systems; it does not push.
- Stock-as-ledger schema (`stock_movements`) remains — it's the right shape even without external integrations, gives audit trail for free.
- Low Stock / Dead Stock / Fast Movers as dashboard views (pure SQL queries).
- API surface for the future Internal Website is *designed* but not exposed in v1.

### Filed in
`docs/adr/0004-product-and-stock-model.md`, `CONTEXT.md` (Inventory)

---

## Decision 14 — Backup strategy

### Insight
- Per-Client backup ≠ full-system backup. They have different audiences, formats, and triggers.
- Neon already does point-in-time recovery (free tier: last snapshot; paid: 7-day window). Don't reinvent.
- Per-Client wants portable data (CSV + files in a ZIP). Full-system wants restorability (`pg_dump` + Drive manifest).
- Drive content is its own backup (Google's redundancy); bundling it in system backups doubles size for no real safety gain.

### Options offered
1. **Per-Client on demand + Admin full-system nightly + Neon PITR (Recommended)** ← your choice
2. Same but on-demand only
3. Per-Client only, no system backup
4. Real-time replication + S3 mirror

### Your answer
> Per-Client on demand + Admin full-system nightly + Neon PITR (Recommended)

### Decision
- **Per-Client (on demand):** Primary triggers a ZIP containing products CSV+JSON, stock_movements CSV, categories, team, 30-day audit_log, images, documents, and a manifest.json. Lands in `<Workspace>/Backups/`. Retain last 5 + 1/month for 12 months.
- **System (nightly, 3 am IST):** Scheduled Function runs `pg_dump` (gzipped) + Drive manifest (file IDs + paths + sha256) → `tar.gz` → `System Backups/`. Retain last 30 + 1/month for 12 months.
- **Neon PITR:** safety net beneath both.

### Filed in
`docs/adr/0005-files-backups-audit-deployment.md`, `CONTEXT.md` (Audit & backups)

---

## Decision 15 — Audit log scope, detail, retention

### Insight
- "Log everything" overwhelms the viewer; bulk operations should log one summary row, not N rows.
- Three categories matter: security (logins, impersonation), structural (roles, team), business (CRUD).
- Diff granularity is the difference between "useful audit log" and "ignored audit log" — store `before` + `after` JSON of changed fields.
- Stock movements are already audited via the ledger; don't duplicate them.

### Options offered
1. **Security + structural + business + diffs + 90d hot + archive (Recommended)** ← your choice
2. Same but no diffs
3. Security + structural only
4. Everything forever, no archive

### Your answer
> Security + structural + business events, before/after diffs, 90d hot + archive (Recommended)

### Decision
- Single `audit_events` table with `actor_user_id` (real), `on_behalf_of` (impersonated user), `impersonation_reason`, `action`, `resource_type`, `resource_id`, `before_data` jsonb, `after_data` jsonb, `metadata`, `occurred_at`.
- Bulk ops logged as one summary row.
- 90 days hot in Postgres; monthly Scheduled Function archives older rows to `<Workspace>/Audit Archive/` as CSV and deletes from hot table.
- UI views: Workspace Activity, Admin Activity, Product History, System Audit.

### Filed in
`docs/adr/0005-files-backups-audit-deployment.md`, `CONTEXT.md` (Audit & backups)

---

## Decision 16 — GitHub repo + deployment workflow

### Insight
- Netlify free tier is generous (300 build min/mo, 100 GB bandwidth, unlimited deploys). The "limited pushes" concern is solvable by using feature branches.
- `netlify dev` gives a 1:1 local production preview against a Neon dev branch — zero deploys needed for iteration.
- Single repo keeps frontend ↔ backend changes atomic.
- Neon supports branching like Git — three environments map cleanly to three Neon branches.

### Options offered
1. **GitHub repo + Netlify auto-deploy on main + branch previews + Neon branching (Recommended)** ← your choice
2. GitHub + manual Netlify deploy only
3. Monorepo with separate /frontend and /backend trees
4. Two repos (frontend, backend)

### Your answer
> GitHub repo + Netlify auto-deploy on main + branch previews + Neon branching (Recommended)

### Decision
- **Single GitHub repo.** Layout:
  ```
  exsol-data-collection-app/
  ├── public/                  static frontend
  ├── netlify/functions/       TS Netlify Functions
  │   └── lib/                 shared: db, drive, auth, rls
  ├── db/migrations/           numbered SQL files
  ├── docs/adr/                this folder
  ├── CONTEXT.md               glossary
  ├── netlify.toml
  ├── package.json
  └── tsconfig.json
  ```
- **Environments:**
  - Local: `netlify dev` + Neon `dev` branch + test Drive + test Google OAuth client.
  - Preview: feature branches auto-build Netlify previews + ephemeral Neon branches.
  - Production: `main` auto-deploys + Neon `main` + production Drive + production OAuth.
- **Secrets in Netlify env vars per environment:** `NEON_DATABASE_URL`, Drive service-account JSON, Google OAuth ID/secret, JWT signing secret, Resend API key, admin Google email.

### Filed in
`docs/adr/0005-files-backups-audit-deployment.md`, `CONTEXT.md` (Deployment)

---

## Where everything is documented

| Area | File |
|---|---|
| Domain glossary | `CONTEXT.md` |
| Hosting, DB, language | `docs/adr/0001-stack.md` |
| Authentication | `docs/adr/0002-authentication.md` |
| Tenancy, roles, impersonation, per-Client key | `docs/adr/0003-tenancy-and-impersonation.md` |
| Product schema, stock ledger, exports | `docs/adr/0004-product-and-stock-model.md` |
| Files, backups, audit, deployment | `docs/adr/0005-files-backups-audit-deployment.md` |
| This learning log | `docs/grilling-log.md` |

---

## Key reframes by you that changed the plan meaningfully

1. **"Netlify is a must"** — locked the frontend host before we drifted into Railway/Render world. Forced the design into Netlify Functions + Neon + Drive.
2. **"Google Auth"** — collapsed the four-provider auth requirement into a single primary + a small fallback. Saved ~2 weeks of integration work.
3. **"Where does the admin fit here?"** — surfaced a modeling ambiguity. Admin is a system-level role, not a Workspace member. This shaped the entire schema.
4. **"God mode" impersonation** — different from the industry default; turned the audit log into a customer-facing product feature instead of an internal tool.
5. **"Include Swiggy/Zomato as a food product type"** — added `product_type` enum and conditional UI; broader v1 scope than originally recommended.
6. **"The data collection app really doesn't need to communicate with external platforms"** — biggest single simplification of the session. Removed live WA/Meta/Shopify integration from v1 scope. Confirmed hub-and-spoke topology.

---

## Smaller decisions deferred to implementation time

These don't carry architectural risk and can be settled as you build the first screens:

- CSS approach (vanilla vs Tailwind vs a small utility set)
- Dark mode toggle and theme persistence ("Theme" from the brief)
- Filter UI patterns on the dashboard (chips vs sidebar facets)
- Currency formatting (default: INR with ₹)
- Email sender identity for Resend (which domain you'll send from)
- Custom domain vs `*.netlify.app` for v1
- Concrete JSON schemas for each marketplace overlay (defer until first Client actually needs that marketplace)
- Exact food-item field set within `physical_goods` vs `food_item` (defer to first food Client)

---

## What I'd do differently next session

For future learning, a couple of process observations:

- **The biggest savings came from re-framing, not from picking options.** Three of the deepest cost reductions (hub-and-spoke topology, Google-only auth, deferred marketplace integrations) came from you pushing back on the *premise* of a question, not from picking option A vs B. Pushback is valuable — keep doing it.
- **Diagrams unstuck two key moments** ("Where does the admin fit?" and "Will images appear as links?"). When a question feels off, asking for a picture often surfaces the confusion faster than another paragraph of options.
- **Defer marketing automation, defer external integrations.** The original brief had ambition built into every line; the version that ships is much smaller and that's a feature, not a regression.
