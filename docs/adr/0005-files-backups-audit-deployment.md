# ADR 0005: Files, Backups, Audit, and Deployment

- **Status:** Accepted
- **Date:** 2026-05-19

## Context

Final architectural decisions covering: file-manager scope, backup strategy, audit log, image pipeline, and the GitHub/Netlify deployment workflow. Bundled as one ADR because they share supporting infrastructure (Google Drive folder tree, Scheduled Functions, Netlify env vars).

## Decisions

### Image pipeline
- **Upload:** Browser requests a Drive resumable-upload session URL from a Netlify Function; bytes go directly to Drive (no Function buffering, no 6 MB cap).
- **Serve:** Image is fetched via `/.netlify/images?url=/api/img/<id>&w=200` — Netlify Image CDN edge-caches the resized variant for 30 days.
- **Limits:** 5 images per product (configurable later), 10 MB each, accepted MIME types: jpeg, png, webp, avif.
- **Drive layout:** `<Workspace>/Products/<sku>/` holds main + detail images per product.

### File manager
- **Scope:** Per-Workspace, browser-based, simple CRUD (browse, upload, download, rename, delete, create folder). No drag-drop, multi-select, or trash in v1.
- **Permissions:** Primary and Manager get full CRUD; Storekeeper gets read + upload only.
- **Admin view:** Same UI scoped across all Workspaces; can also access `System Backups/`.
- **Backed by:** Google Drive folders under `ExSol Data Collection/<Workspace>/{Products,Documents,Backups,Exports,Audit Archive}/`.

### Backups
- **Per-Client (on demand):** Primary clicks "Backup". Generates a ZIP containing `products.csv`, `products.json`, `stock_movements.csv`, `categories.csv`, `team.csv`, `audit_log.csv` (30d window), `images/<sku>/...`, `documents/...`, and a `manifest.json`. Lands in `<Workspace>/Backups/`. Retention: last 5 + one per month for 12 months.
- **Admin full-system (nightly):** Scheduled Function at 3 am IST runs `pg_dump` (compressed), writes a Drive manifest (every file ID + path + sha256), bundles into `tar.gz`, uploads to `System Backups/`. Drive file *content* is not bundled — Drive's redundancy is its own backup. Retention: last 30 + one per month for 12 months.
- **Neon PITR:** Free-tier snapshot is the safety net beneath both. Upgrade to a paid plan when Client count justifies the cost.

### Audit log
- Single `audit_events` table covering security, structural, and business events. Stock movements stay in their own ledger and are merged in UI views.
- Before/after JSON diffs of changed fields per event. Bulk operations logged as one summary event with a count.
- Retention: 90 days hot in Postgres. A monthly Scheduled Function archives older rows as CSVs into `<Workspace>/Audit Archive/` and deletes them from the hot table.
- UI views: Workspace Activity (Primary), Admin Activity (Primary), Product History (per product), System Audit (Admin across all Workspaces).

### Deployment workflow
- Single GitHub repo. `main` branch auto-deploys to production Netlify.
- Feature branches generate Netlify deploy previews, each connected to an ephemeral Neon branch (isolated data, free).
- Local dev: `netlify dev` against a permanent Neon `dev` branch and a test Google Drive folder + test OAuth client.
- Schema migrations versioned in `/db/migrations` as numbered SQL files. Applied to feature-branch Neon before merge.
- Secrets in Netlify env vars per environment: Neon URL, Drive service-account JSON, Google OAuth client ID/secret, JWT signing secret, Resend API key, admin Google email.

### Repo layout
```
exsol-data-collection-app/
├── public/                          # static frontend (HTML/CSS/JS)
├── netlify/functions/               # TypeScript Functions
├── db/migrations/                   # numbered SQL files
├── docs/adr/                        # this folder
├── CONTEXT.md                       # glossary
├── netlify.toml                     # build + function config
├── package.json, tsconfig.json
└── README.md
```

## Consequences

- Drive remains the single file-storage layer for v1; no R2/S3 dependency.
- Audit log archival means long-term queries become a "load this CSV" task, not an SQL query. Acceptable for compliance/audit; revisit if analytics needs change.
- Backups don't include Drive content bytes — operationally efficient but means a Drive outage during a restore is a real (rare) risk.
- Feature-preview deploys with isolated Neon branches give safe schema-migration review. This is the single biggest dev-experience win in this ADR.

## Alternatives considered

- **Bundle Drive contents into system backups** — rejected; doubles backup size and Drive is already redundant.
- **Audit log retained indefinitely in Postgres** — rejected; storage cost grows linearly with usage.
- **Two repos for frontend/backend** — rejected; breaks atomic feature PRs.
- **R2 instead of Drive for images** — held as a future migration path if Drive limits become user-visible.
