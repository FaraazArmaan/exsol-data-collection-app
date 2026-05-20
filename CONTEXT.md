# ExSol Data Collection App — Glossary

This file is the canonical vocabulary for the project. It is **not** a spec, scratch pad, or design doc — only resolved domain terms with one-line definitions. Implementation details belong in `docs/adr/`.

## People

- **Admin** — Single top-level operator of the platform (currently `theexsolenterprise@gmail.com`). Onboards Clients, sees all data, can impersonate any user. Distinct role; not a "Client with extra permissions."
- **Client** — A business onboarded by the Admin. Owns a workspace containing Products, Files, Team Members, and Backups. Has exactly one **Primary User**.
- **Primary User** — The Client's owner-account. Sign-in identity for the Client. Can invite Secondary Users, edit Products, configure the Client's settings.
- **Secondary User** — A team member of a Client (e.g., storekeeper). Invited by the Primary User. Has a role that scopes their permissions within the Client's workspace.
- **Workspace** — A Client's isolated data world. All Products, Files, audit history, and Team Members belong to exactly one Workspace.

## Roles

- **Admin** — System-level. Lives outside all Workspaces. Cannot have a Workspace membership row.
- **Primary** — Workspace-level. The Client's owner-account. Full control inside the Workspace.
- **Manager** — Workspace-level. Can edit products, prices, marketplace listings, and stock; cannot invite/remove team or change Workspace settings.
- **Storekeeper** — Workspace-level. Can update stock counts and log stock movements; cannot create/delete products, edit prices, or export.

A given user can be Primary in one Workspace and Manager in another (e.g., a chain owner has a "head office" Workspace and is a Manager in a franchisee's Workspace). Membership is many-to-many via `workspace_memberships(user_id, workspace_id, role)`.

## Auth

- **Sign-in identity** — A verified Google account, or in the fallback flow a verified email+password. A user has exactly one sign-in identity.
- **Role** — `admin`, `primary`, or `secondary`. Determined by the DB record for the signed-in identity. Not stored in the JWT alone.

## Catalog

- **Product** — A sellable item owned by a Workspace. Has a canonical core (SKU, name, price, stock, images, dimensions, etc.) plus zero or more **Marketplace Overlays**. Identified uniquely within a Workspace by SKU.
- **Product Type** — `physical_goods` or `food_item`. Determines which form fields appear and which marketplaces are eligible. Food items are listable on Swiggy/Zomato; physical goods on Amazon/Flipkart/Meta/WA/Rakuten/AliExpress.
- **Marketplace** — One of `amazon`, `flipkart`, `meta`, `wa`, `rakuten`, `aliexpress`, `swiggy`, `zomato`. v1 set; extensible.
- **Marketplace Overlay** — A JSONB blob of marketplace-specific fields attached to a Product, with an `enabled` flag and a `last_synced` timestamp. A Product has at most one overlay per Marketplace.
- **Category** — A Workspace-defined classification (with sub-categories). Distinct from marketplace-specific category trees, which live in the overlays.

## Per-Client gate

- **Admin Access Key** — A 12-character random secret per Workspace, set at onboarding, rotatable by the Primary. Admin must enter it before viewing or impersonating in that Workspace. Stored as Argon2id hash. Failed attempts rate-limited; locked Workspace alerts Primary by email.
- **Workspace Unlock** — A 15-minute session claim Admin gets after entering the correct Admin Access Key. Auto-extends on activity. Required for Impersonation.

## Impersonation

- **Impersonation Session** — A 30-minute window in which the Admin acts in the UI as a specific Workspace member. God-mode powers (retains all admin abilities). Requires Workspace Unlock + written reason. Auto-expires.
- **Admin Activity** — A Client-facing view of audit-log rows tagged with impersonation, surfacing Admin actions on a Workspace with the reason that was given.

## Inventory

- **Stock Movement** — A single row in the `stock_movements` ledger: `(product_id, delta, reason, source, external_ref, actor_id, occurred_at)`. Append-only. The source of truth.
- **Stock Count** — Derived from `SUM(delta)` over movements; materialized on `products.stock_count` via trigger.
- **Source** (of a movement) — `manual` | `csv` | `recount` in v1. Extensible.
- **Reason** (of a movement) — `purchase` | `sale` | `damage` | `recount` | `manual_adjust`. Extensible.
- **Recount** — A movement source representing a Storekeeper observing the shelf and entering an absolute count; the system records the delta needed to reach it.
- **Low Stock / Dead Stock / Fast Movers** — Dashboard views derived from `stock_movements` + thresholds. SQL queries, no ML.

## Files & exports

- **Blob Store** — Netlify Blobs namespace used for binary persistence. v1 stores: `product-images` (in use), `product-exports`, `workspace-backups`, `system-backups` (Modules 11/12). Keys are opaque `<wsid>_<pid>_<uuid>` strings; values are byte blobs with `contentType` metadata. See ADR-0006.
- **Image Key** — A `product-images` Blob store key, recorded on `products.primary_image_id` or `products.extra_image_ids`. Opaque to the rest of the app — only `blobStorage` and the `/api/img` proxy interpret it.
- **Export Job** — A row in `export_jobs` table tracking an async export. States: `queued`, `running`, `done`, `failed`. Owns the resulting Blob key and the requesting user.
- **Comprehensive Export** — XLSX or CSV containing every core field + every enabled overlay flattened. Default target for the future Internal Website.
- **Meta Catalog CSV** — CSV in Meta's exact catalog schema; works for both Meta Commerce and WhatsApp Business Catalog.

## Audit & backups

- **Audit Event** — A row in `audit_events`: who (real actor), on-behalf-of (if impersonating), action, resource, before/after diff, metadata, timestamp. 90 days hot, then archived as CSV to the `system-backups` Blob store.
- **Per-Client Backup** — On-demand ZIP snapshot of a Workspace's data + image bytes. Triggered by Primary, stored in the `workspace-backups` Blob store keyed by workspace.
- **System Backup** — Nightly SQL dump + manifest, Admin-only, stored in the `system-backups` Blob store. Image bytes are NOT duplicated into the backup (they live in their own store and have their own retention).
- **Neon PITR** — Underlying point-in-time recovery from Neon itself; the deepest safety net.

## Deployment

- **Local dev** — `netlify dev` running against the Neon `dev` branch + a sandboxed local Blobs store (auto-provisioned by `netlify dev`). The only environment that doesn't deploy anywhere.
- **Deploy Preview** — Netlify-generated URL per feature branch, connected to an ephemeral Neon branch with isolated data. Used for review before merge.
- **Production** — `main` branch auto-deployed by Netlify. Connected to Neon `main`, the production Blobs store (auto-provisioned per Netlify site), and production Google OAuth client.
