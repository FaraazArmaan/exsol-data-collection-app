# PRD — ExSol Data Collection App, v1

- **Status:** Ready for agent
- **Date:** 2026-05-19
- **Triage:** `ready-for-agent`
- **Related:** `CONTEXT.md`, `docs/adr/0001`..`0005`, `docs/grilling-log.md`

---

## Problem Statement

Faraaz (Admin) runs a service that prepares Client product catalogs for publication on marketplaces (Meta Catalog, WhatsApp Business, future custom ecommerce, future ERP) and helps Clients keep stock counts coherent. Today, this work happens through ad-hoc spreadsheets and direct hand-offs: every new Client means another spreadsheet template, every stock update means a phone call or a WhatsApp message, and every marketplace export means re-formatting the data by hand.

From the Admin's perspective, the pain is:
- No single place to see all Clients and their product catalogs at once.
- No way for Clients to self-serve product additions or stock updates.
- No structured audit trail when the Admin steps in to help a Client.
- Marketplace exports are manual and error-prone.
- Backups depend on remembering to make them.

From a Client's perspective (Primary, Manager, or Storekeeper at a small/mid business in India), the pain is:
- No shared, multi-user workspace for product and stock data — only the owner has the spreadsheet.
- Stock counts go stale because there's no easy way for a Storekeeper to record what was sold or received.
- Preparing a marketplace catalog upload requires the owner to manually re-shape data each time.
- No visibility into which products are moving fast, sitting dead, or low on stock.

---

## Solution

A web app — **ExSol Data Collection App** — that gives Admin a single home for all Clients and gives each Client a dedicated, isolated **Workspace** containing their products, stock, files, and team. The app is the **hub** in a hub-and-spoke topology: it is the source of truth for product and stock data, and downstream systems (future Internal Website / ERP, future custom ecommerce, future Booking/Catalog sites) consume from it.

The app is accessible from desktop, tablet, and mobile browsers — one responsive codebase, no native apps.

Key user-facing capabilities:

- **Sign in** via Google (primary) or email + password (fallback).
- **Admin Dashboard:** see every Client, unlock a Client via a per-Workspace access key, impersonate any user with reason and audit, run system backups, browse all backups.
- **Client Dashboard:** Primary, Manager, or Storekeeper sees a Product Dashboard with their workspace's products. Each role has scoped permissions.
- **Product CRUD:** create products with a core set of fields plus optional per-marketplace overlays. Two product types: `physical_goods` and `food_item`. Marketplaces in v1: Amazon, Flipkart, Meta, WhatsApp Business, Rakuten, AliExpress, Swiggy, Zomato (overlays only — no live sync).
- **Stock ledger:** every stock change is a movement (IN, OUT, recount, damage…); the current count is derived. Three sources: manual, CSV bulk import, recount. Low Stock / Dead Stock / Fast Movers views.
- **Exports:** comprehensive XLSX/CSV (every field flattened, consumed by downstream systems) and Meta Catalog CSV (Meta's schema, works for WA and Meta). Small exports run synchronously; large ones run as background jobs and land in the Workspace's Exports folder.
- **File manager:** simple, breadcrumb-based browse/upload/download/rename/delete/create-folder per Workspace; Admin browses all Workspaces.
- **Backups:** Primary triggers a per-Client ZIP backup on demand; Admin's nightly system backup runs at 3 am IST.
- **Audit log:** 90 days hot + GDrive archive; views for Workspace Activity, Admin Activity (Client-facing), Product History, System Audit.
- **Impersonation:** Admin can act as any Workspace user with a required reason, persistent banner, 30-min auto-expire, and full audit attribution. (God-mode: Admin retains admin powers while impersonating.)

---

## User Stories

### Sign-in and account

1. As a Primary User, I want to sign in with my Google account in one click, so that I don't have to manage a separate password.
2. As a Primary User without a Gmail account, I want to register with my email and a password, so that I can still use the app.
3. As an email + password user, I want to verify my email address before my account is active, so that nobody else can register with my address.
4. As an email + password user, I want to reset my password if I forget it, so that I can regain access.
5. As any user, I want my session to persist for 30 days unless I sign out, so that I don't re-authenticate every visit.
6. As any user, I want my session to be securely scoped (HTTP-only cookie, signed JWT), so that my account cannot be hijacked by a malicious script.
7. As Admin, I want my Google account to require 2FA at sign-in, so that a stolen password cannot compromise the entire system.
8. As any user, I want a clear sign-out action, so that I can end my session on shared devices.
9. As any user attempting to sign in with an unknown email, I want a clear "your account must be created by your admin or Client owner" message, so that I understand the platform doesn't allow self-signup.

### Admin Dashboard — Client management

10. As Admin, after signing in I want to land on an Admin Dashboard listing every Client, so that I can pick which one to work on.
11. As Admin, I want to onboard a new Client by entering their name, the Primary User's email, and any initial setup details, so that a new Workspace is created with a fresh Drive folder and a generated admin access key.
12. As Admin, I want the generated admin access key for a new Client to be shown to me once at the end of onboarding, so that I can share it with the Primary out-of-band.
13. As Admin, I want to view a Client's summary card (Primary email, last activity, product count, storage used, backup status) without needing to unlock the Workspace, so that I can triage at a glance.
14. As Admin, I want to disable a Client (suspend access for all of their users without deleting data), so that I can handle non-payment or offboarding.
15. As Admin, I want to re-enable a previously disabled Client, so that a paused engagement can resume without re-onboarding.
16. As Admin, I want to delete a Client entirely (with a confirmation prompt and a 30-day soft-delete window), so that I can remove a customer who has churned.

### Per-Client unlock + impersonation

17. As Admin, before viewing any Client's data, I want to be prompted for that Client's admin access key, so that a compromised Admin Google account alone cannot read all Client data.
18. As Admin, after entering the correct key, I want a 15-minute unlock window that auto-extends on activity, so that I don't have to re-enter the key during a single session.
19. As Admin, after 5 failed key attempts in 10 minutes against the same Client, I want my Admin↔Client pair to be locked out for 1 hour and the Primary to be alerted by email, so that brute-force attempts are noticed and blocked.
20. As a Primary User, I want to rotate my Workspace's admin access key at any time from the Workspace settings, so that I can refresh the key if I suspect it was leaked.
21. As Admin, while a Workspace is unlocked I want to choose "Impersonate this user" on any team member's row, so that I can debug issues from their exact perspective.
22. As Admin, before impersonation starts, I want to be required to enter a short written reason ("Helping Alice fix WA Catalog export"), so that my actions during impersonation are explainable to the Client.
23. As Admin, while impersonating, I want a persistent site-wide banner showing the user I'm acting as, the time remaining, and an Exit button, so that I cannot forget I'm in an impersonation session.
24. As Admin, my impersonation session must expire after 30 minutes automatically, so that stale sessions can't be abused.
25. As Admin, when impersonating, I want to keep my admin powers (god mode) while also operating in the user's UI, so that I can quickly do things the user couldn't (e.g., backup, system-level diagnostics) without exiting the session.
26. As a Primary User reviewing my Workspace's audit, I want a dedicated "Admin Activity" tab showing every action the Admin took on my Workspace with the reason that was given, so that I have transparency into Admin interventions.
27. As Admin, when I attempt a destructive action while impersonating (delete Workspace, mass-delete products, irreversible exports), I want a confirmation modal that explicitly says "You are doing this AS <user>", so that I do not perform irreversible actions by mistake.

### Product Dashboard — viewing

28. As a Primary, Manager, or Storekeeper signing in, I want to land on my Workspace's Product Dashboard, so that I see the products immediately.
29. As any signed-in Workspace user, I want the dashboard to show a table of products with name, primary image (thumbnail), price, category, sub-category, stock quantity, and last-updated timestamp, so that I can scan inventory at a glance.
30. As any signed-in Workspace user, I want to filter the table by category, sub-category, status (draft/active/archived), marketplace-enabled flag, low-stock threshold, and free-text search across name/SKU/tags, so that I can drill into the products I care about.
31. As any signed-in Workspace user, I want to sort the table by any column, so that I can find the highest-priced or lowest-stock items quickly.
32. As any signed-in Workspace user, I want a "Last updated" column showing relative time ("2 hrs ago"), so that I can tell which products are stale.
33. As any signed-in Workspace user, I want to toggle between light and dark themes, with my preference remembered across sessions, so that the app matches my environment.
34. As any signed-in Workspace user on mobile, I want a responsive layout where the product table reflows to cards, so that I can use the app from my phone.
35. As any signed-in Workspace user, I want pagination (or infinite scroll) on the product table, so that a Workspace with 10,000 products still loads quickly.
36. As any signed-in Workspace user, I want a "Bulk actions" multi-select on the product table allowing bulk export, bulk archive, and bulk price update, so that I can act on many products at once.

### Product CRUD

37. As a Primary or Manager, I want to create a new product by filling a form with the canonical core fields (SKU, name, description, price, currency, cost, stock count, dimensions, weight, GST/HSN code, GST rate, barcode, category, sub-category, tags, status, images), so that I can add inventory to my catalog.
38. As a Primary or Manager creating a product, I want to choose a product type — `physical_goods` or `food_item` — at the top of the form, so that the form shows the right fields below.
39. As a Primary or Manager creating a `food_item`, I want additional conditional fields (prep_time, modifiers, dietary_tags, spice_level, portion sizes), so that the product is ready for Swiggy/Zomato.
40. As a Primary or Manager, I want SKUs to be unique within my Workspace, with a clear error if I enter a duplicate, so that downstream systems can rely on SKU.
41. As a Primary or Manager, I want to upload up to 5 images per product (jpeg/png/webp/avif, max 10 MB each), so that I can show the product properly on marketplaces.
42. As a Primary or Manager, when I upload an image, I want the browser to upload it directly to storage without going through a small server (no upload-size limit), so that large product photos don't fail with a 413 error.
43. As a Primary or Manager, when an image upload completes, I want a thumbnail to appear immediately in the form preview, so that I can verify it succeeded.
44. As a Primary or Manager, I want to mark images as primary/detail and reorder them, so that the displayed-first image is correct.
45. As a Primary or Manager editing a product, I want to switch to per-marketplace overlay tabs (Amazon, Flipkart, Meta, WA, Rakuten, AliExpress, Swiggy, Zomato) and fill marketplace-specific fields, so that the product is ready for each platform.
46. As a Primary or Manager, I want each marketplace overlay to have an "Enabled" toggle, so that only enabled overlays are included in marketplace-specific exports.
47. As a Primary or Manager, I want the marketplace tabs to be hidden if the product type doesn't apply (e.g., Swiggy/Zomato hidden for `physical_goods`), so that I don't see irrelevant options.
48. As a Primary or Manager, I want to delete a product, with a confirmation modal that previews how many stock movements will be archived, so that I don't lose audit history by accident.
49. As a Primary or Manager, I want to bulk-import products from a CSV that matches the comprehensive export schema, so that I can onboard quickly from an existing spreadsheet.
50. As a Primary or Manager, during bulk import I want a dry-run validation report (rows-to-create vs rows-to-update vs rows-with-errors), so that I can fix issues before committing.
51. As a Primary or Manager, I want a successful bulk import to be logged as a single audit event ("imported 1,247 products from CSV") rather than 1,247 individual events, so that the audit log stays readable.
52. As a Primary or Manager, I want to duplicate an existing product as a starting point for a new product, so that I don't re-type shared values.
53. As a Storekeeper, I want product CRUD actions (create/edit/delete/price-change) to be disabled in my UI with clear "Ask your manager" tooltips, so that I'm not confused about my permissions.

### Stock — manual updates and ledger

54. As a Primary, Manager, or Storekeeper, I want to update a product's stock by either entering an absolute count (recount workflow) or a delta (received +20, sold -3, damaged -1), so that I can record what happened.
55. As any user updating stock, I want to attach a reason from a fixed list (purchase, sale, damage, recount, manual_adjust) plus an optional note, so that the ledger is meaningful.
56. As any user updating stock, I want a confirmation summary ("This will change stock from 47 to 50, recording +3 as a recount") before committing, so that I don't slip a digit.
57. As any user updating stock, I want the change to appear in the Product History audit view immediately, so that I can verify it was recorded.
58. As a Primary or Manager, I want to bulk-update stock via CSV (columns: SKU, new_count, reason, note), so that monthly recount is fast.
59. As any user, I want concurrent stock updates from two team members to never cause negative or stale counts, so that the data stays trustworthy.
60. As a Primary or Manager, I want to configure a per-product low-stock threshold and an optional dead-stock threshold (no movement in N days), so that the dashboard highlights what needs attention.
61. As any user, I want a "Low Stock" view listing all products at or below their threshold, so that I can reorder or push them out.
62. As any user, I want a "Dead Stock" view listing products with no stock movement in N days, so that I can plan clearance.
63. As any user, I want a "Fast Movers" view listing the top 10 products by recent movement velocity, so that I can keep them in stock.

### Exports

64. As a Primary or Manager, I want to export the full Workspace catalog as a comprehensive XLSX (every core field + every enabled overlay flattened), so that I can hand it to my downstream Internal Website / ERP.
65. As a Primary or Manager, I want the same data as a comprehensive CSV, so that automation pipelines can consume it.
66. As a Primary or Manager, I want a "Meta Catalog CSV" export option that produces a file in Meta's exact catalog schema, so that I can upload it directly to my Meta Commerce Manager and to WhatsApp Business Catalog without re-shaping.
67. As a Primary or Manager, before generating an export, I want to apply filters (all, by category, by marketplace-enabled flag, by date range, by selection in the table), so that I can narrow the output.
68. As a Primary or Manager, for small exports (estimated ≤ 500 products or ≤ 2 MB) I want the file to download in my browser immediately, so that quick tasks stay fast.
69. As a Primary or Manager, for large exports I want a queued job with an in-app toast that fires when the file is ready, plus the file landing in the Workspace's Exports folder, so that I'm not blocked waiting.
70. As a Primary or Manager, I want a dedicated Exports tab listing every past export with timestamp, target, filter applied, and a re-download link, so that I can find a file I generated last week.
71. As a Storekeeper, I want export actions hidden or disabled in my UI, so that I cannot inadvertently send catalog data outside.

### File manager

72. As a Primary or Manager, I want a per-Workspace file manager showing a folder tree (Products, Documents, Backups, Exports, Audit Archive), so that all Workspace files are in one place.
73. As any signed-in Workspace user, I want a breadcrumb trail at the top of the file manager showing the current folder path, so that I can navigate up easily.
74. As a Primary or Manager, I want to upload files via a button (single or batch), rename, delete, create folder, and download from the file manager, so that I can manage non-product documents (invoices, supplier quotes, supplier price lists).
75. As a Storekeeper, I want read + upload access in the file manager (no rename, no delete), so that I can drop in shelf-count photos and receipts.
76. As any signed-in Workspace user, I want file thumbnails for image types and file-type icons for everything else, so that the folder is scannable.
77. As Admin, I want a file manager view that lets me switch between any Workspace's folder tree, plus the System Backups folder, so that I can audit and recover.
78. As any user, I want file uploads larger than the inline limit to be uploaded directly to storage (browser → storage) without buffering through a server, so that large PDFs don't fail.

### Backups

79. As a Primary, I want a one-click "Backup my Workspace" action that produces a ZIP containing my products (CSV + JSON), stock movements, categories, team list, 30-day audit log, images, and documents, so that I have my own portable snapshot.
80. As a Primary, I want each backup to land in my Workspace's Backups folder with a timestamped filename, so that I can download or share it.
81. As a Primary, I want the system to keep the last 5 backups + one per month for 12 months automatically, deleting older ones, so that storage doesn't grow forever.
82. As a Primary, I want the option to schedule recurring backups (off by default, configurable to daily/weekly), so that I don't have to remember.
83. As Admin, I want the system to run a full-system backup nightly at 3 am IST (database dump + Drive file manifest), so that I have a disaster-recovery snapshot.
84. As Admin, I want the system to keep the last 30 system backups + one per month for 12 months, so that I can restore from any recent point.
85. As Admin, I want an ad-hoc "Run System Backup Now" button, so that I can take a snapshot before a risky change.
86. As Admin, I want a clear restore-instructions README inside the system backup tar.gz, so that disaster recovery is documented at the moment of need.

### Audit log

87. As a Primary or Manager, I want a Workspace Activity tab showing every change in my Workspace (logins, product CRUD, role changes, exports, backups), so that I have a complete history.
88. As a Primary, I want a separate Admin Activity tab filtered to events where the real actor was the Admin (during impersonation), so that I can see what was done on my behalf and why.
89. As any signed-in Workspace user, I want each event to show the actor, the action, the resource, the timestamp (in my timezone), and an expandable before/after diff for updates, so that I can understand exactly what changed.
90. As any user opening a product, I want a Product History tab listing every event scoped to that product, so that I can answer "who changed this price?".
91. As Admin, I want a System Audit view aggregating events across all Workspaces with filters by actor, action, resource type, and date range, so that I can investigate cross-Client issues.
92. As any audit-log viewer, I want events older than 90 days to be served from the archived CSVs in the Audit Archive folder, so that long-term history is retrievable without bloating Postgres.

### Team management

93. As a Primary, I want to invite a new team member by email and role (Manager or Storekeeper), so that I can build my team.
94. As a Primary, I want each invited user to receive an email with a link to accept, so that they know to sign in.
95. As a Primary, I want to change a team member's role at any time, so that promotions and demotions are easy.
96. As a Primary, I want to remove a team member, with confirmation, so that off-boarding is one action.
97. As a Manager or Storekeeper, I want to see my own profile and current role in the app, so that I understand my permissions.
98. As a Primary, I want a clear list of pending invitations (not-yet-accepted) with a "Resend" option, so that I can follow up.

### Notifications

99. As a Primary, I want an email when my Workspace gets locked due to too many failed Admin key attempts, so that I'm aware of possible misuse.
100. As a Primary, I want an in-app toast (and optional email) when a backup completes, so that I know it succeeded.
101. As a Primary, I want an in-app toast (and optional email) when an export job completes, so that I can fetch the file.
102. As any user, I want a configurable per-user notification preferences page (in-app only, in-app + email), so that I'm not spammed.
103. As Admin, I want an email when a system backup fails, so that I can fix it before the next scheduled run.

### Mobile / tablet

104. As any signed-in user on a mobile browser, I want the app to be fully usable for stock updates, file uploads, and viewing the dashboard, so that I can run the business from my phone.
105. As any signed-in user on a tablet, I want a layout intermediate between mobile and desktop (e.g., split-pane product editor), so that the screen is used well.

### Settings & administration

106. As a Primary, I want a Workspace Settings page where I can edit Workspace name, default currency, timezone, low-stock thresholds, theme defaults, and rotate the admin access key, so that the Workspace fits my business.
107. As any user, I want a Profile page where I can edit my name, photo (or use my Google photo), email notification preferences, and (for email/pw users) change my password, so that my profile is accurate.
108. As Admin, I want a System Settings page covering backup schedule, system-wide notification email, default new-Workspace settings, and audit-archive retention, so that I can tune the platform.

---

## Implementation Decisions

### Stack
- **Frontend:** Static HTML/CSS/Vanilla JS, hosted on Netlify. One responsive codebase for desktop, tablet, mobile.
- **Backend:** Netlify Functions, all TypeScript. Long-running work (exports, backups, audit archive) runs in Netlify Scheduled Functions polling a `jobs` table.
- **Database:** Neon Postgres, single shared database with `workspace_id` + Postgres RLS for tenancy.
- **File storage:** Google Drive, single owner account (Admin's), one root folder `ExSol Data Collection/` with per-Workspace subfolders.
- **Auth:** Google Identity Services (primary) + email + password with Argon2id (fallback) + Resend for verification/reset emails.
- **Session:** Signed JWT in HTTP-only cookie; 15-min access + 30-day refresh.
- **Image delivery:** Direct-browser-to-Drive resumable upload + Netlify Image CDN proxy with 30-day edge cache.

(See `docs/adr/0001`..`0005` for full rationale and alternatives considered.)

### Deep modules (13)

Each is implemented behind a stable interface. Frontend pages and HTTP handlers compose these modules; they do not contain business logic themselves.

1. **`tenancyContext`** — `withTenantContext(userId, workspaceId, fn)`. Opens a transaction, sets `app.current_user_id` and `app.current_workspace_id` GUCs, runs `fn`, returns the result. Admin paths use `withAdminContext` which uses a `SECURITY DEFINER` to bypass RLS for explicitly cross-tenant queries.
2. **`permissionPolicy`** — `can(actor, action, resource) → boolean`. Encodes the full role matrix:
   - Admin: every action.
   - Primary: every action within their Workspace except cross-Workspace.
   - Manager: products + stock + exports + file manager (full); not team, not Workspace settings, not key rotation, not Workspace delete.
   - Storekeeper: stock movements (write); products (read); file manager (read + upload); not delete, not exports, not team.
   - Impersonation: under god mode, `actor.realRole === 'admin'` retains admin-allowed actions regardless of impersonation target.
3. **`authVerifier`** — `verifyCredentials(input)`. Handles `{ provider: 'google', idToken }` and `{ provider: 'email', email, password }`. Returns a canonical `AuthenticatedUser` or a typed `AuthError`. Internally: Google `google-auth-library` for token verification; Argon2id (e.g., `node-argon2`) for password check; rate limit by IP + email; lockout state in Postgres.
4. **`sessionManager`** — `issue(user)`, `verify(cookie)`, `refresh(refreshToken)`, `revoke(...)`. Cookies are HTTP-only, Secure, SameSite=Lax. Claims include `userId`, `realRole` (admin or null), `currentWorkspaceId` (the workspace the user is currently viewing — set at workspace selection time), `unlockedWorkspaces` (array of workspace IDs unlocked in last 15 min), and `impersonation` (if active: `{ targetUserId, workspaceId, reason, expiresAt }`).
5. **`workspaceUnlockManager`** — `attemptUnlock(adminId, workspaceId, key)`, `isUnlocked(session, workspaceId)`, `rotateKey(workspaceId, newKeyPlaintext)`. Stores `admin_access_keys.hash` (Argon2id) per workspace. Tracks `unlock_attempts(admin_id, workspace_id, succeeded_at, failed_at)` for rate limiting. On 5 fails in 10 min: insert `workspace_lockouts(admin_id, workspace_id, until)` and dispatch email via `notificationDispatcher`.
6. **`impersonationManager`** — `begin(adminId, targetUserId, workspaceId, reason)`, `end(sessionId)`, `currentActor(session)`. Begin requires an unlocked workspace; persists an `impersonation_sessions` row; sets session claim; auto-expires at 30 min. `currentActor` returns `{ realActorId, onBehalfOfId, impersonationReason, isImpersonating }` used by every write path.
7. **`auditLogWriter`** — `record(event)`. Single entry point for all events. Pulls actor context from current session via `impersonationManager.currentActor`. Diffs are computed by passing `{ resource, before, after }` — the writer extracts changed fields only. Bulk operations call `record` once with a `bulkSummary: { count, sampleIds }` field instead of one row per item.
8. **`stockLedger`** — `recordMovement(payload)`, `currentCount(productId)`, `recountToAbsolute(productId, absolute, reason, actorId)`. Inserts into `stock_movements`; a Postgres trigger maintains `products.stock_count = SUM(deltas)`. Validates source/reason against allowed enums.
9. **`driveClient`** — `requestUploadSession(folderId, filename, mime, size)`, `getBytes(fileId)`, `createFolder(parentId, name)`, `move(fileId, destFolderId)`, `delete(fileId)`, `list(folderId)`, `ensurePath(pathSegments[])`. Wraps Google Drive API with exponential backoff retry, refresh-token-rotation, and rate-limit awareness. Path resolution caches folder-name → file-id lookups in-memory.
10. **`imagePipeline`** — `requestUploadSession(productId)`, `registerUploadedFile(productId, driveFileId)`, `proxyUrl(productId, variant)` where variant is `thumb`, `card`, `full`. Returns Netlify Image CDN URLs that resolve to `/api/img/:productId/:driveFileId`.
11. **`exportEngine`** — `run({ profile, filter, workspace, requesterId })`. Profiles: `xlsx_comprehensive`, `csv_comprehensive`, `meta_catalog_csv`. Dispatch logic: estimate row count + col count; if ≤ 500 rows or ≤ 2 MB estimated size, run synchronously and return the file bytes; else insert into `export_jobs` and return a job ID. Worker function (Scheduled, every 1 min) picks `queued` jobs, builds the file, uploads to `<Workspace>/Exports/` via `driveClient`, updates row to `done`.
12. **`backupEngine`** — `runWorkspace(workspaceId, requesterId)`, `runSystem(requesterId)`, `pruneRetention()`. Workspace backup composes a ZIP from Postgres queries + Drive file streams. System backup invokes `pg_dump` (via a child process if needed; otherwise SQL via `pg` driver) and produces a tar.gz. Retention pruning runs at end of each backup: keep last N + monthly snapshots.
13. **`productService`** — CRUD methods + `validateOverlay(marketplace, fields)` + `bulkImport(csvRows, mode)`. Overlay validation uses per-marketplace JSON schemas stored as constants. Conditional food-vs-goods field handling at validate-time. SKU uniqueness enforced via unique index on `(workspace_id, sku)`.

### Database schema (sketch)

Decision-rich; inlined here per template exception.

```
users
  id uuid pk, email text unique, name text, photo_url text,
  is_admin bool, google_sub text unique nullable,
  password_hash text nullable, email_verified bool, created_at, updated_at

workspaces
  id uuid pk, name text, primary_user_id uuid -> users,
  currency text default 'INR', timezone text default 'Asia/Kolkata',
  theme_default text, low_stock_default int,
  admin_access_key_hash text, key_rotated_at,
  disabled_at nullable, created_at, updated_at

workspace_memberships
  user_id, workspace_id, role (primary|manager|storekeeper),
  invited_at, accepted_at, created_at
  pk (user_id, workspace_id)

categories
  id uuid pk, workspace_id, name, parent_id nullable, sort_order

products
  id uuid pk, workspace_id, sku text,
  name, description, product_type (physical_goods|food_item),
  category_id, sub_category_id, primary_image_drive_id, extra_image_drive_ids text[],
  price numeric(12,2), currency, cost numeric(12,2),
  stock_count int (materialized from movements),
  stock_unit, weight_g, dim_l_mm, dim_w_mm, dim_h_mm,
  barcode, hsn_code, gst_rate numeric(4,2),
  food_fields jsonb nullable, tags text[],
  low_stock_threshold int, dead_stock_days int,
  status (draft|active|archived),
  created_at, updated_at, updated_by uuid -> users
  unique (workspace_id, sku)

product_marketplace_fields
  product_id, marketplace (amazon|flipkart|meta|wa|rakuten|aliexpress|swiggy|zomato),
  fields jsonb, enabled bool, last_synced timestamptz,
  pk (product_id, marketplace)

stock_movements
  id uuid pk, workspace_id, product_id, delta int,
  reason (purchase|sale|damage|recount|manual_adjust),
  source (manual|csv|recount),
  external_ref text, actor_id, note,
  occurred_at, created_at
  index (workspace_id, occurred_at desc), index (product_id, occurred_at desc)

files
  id uuid pk, workspace_id, drive_file_id text, drive_folder_path text,
  filename, mime, size_bytes, uploaded_by, created_at, deleted_at nullable
  index (workspace_id, drive_folder_path)

export_jobs
  id uuid pk, workspace_id, requester_id, profile,
  filter jsonb, status (queued|running|done|failed),
  drive_file_id text nullable, error text nullable,
  queued_at, started_at, finished_at

backups
  id uuid pk, workspace_id nullable (null for system),
  kind (workspace|system), drive_file_id, size_bytes,
  retention_class (rolling|monthly), triggered_by, status,
  started_at, finished_at

audit_events
  id uuid pk, workspace_id nullable, actor_user_id, on_behalf_of nullable,
  impersonation_reason text nullable,
  action text, resource_type text, resource_id uuid nullable,
  before_data jsonb, after_data jsonb, metadata jsonb,
  occurred_at timestamptz,
  index (workspace_id, occurred_at desc),
  index (actor_user_id, occurred_at desc),
  index (resource_type, resource_id, occurred_at desc)

impersonation_sessions
  id uuid pk, admin_user_id, target_user_id, workspace_id,
  reason text, started_at, expires_at, ended_at nullable

workspace_unlocks
  admin_user_id, workspace_id, unlocked_at, last_extended_at, expires_at

unlock_attempts
  admin_user_id, workspace_id, attempted_at, succeeded bool

workspace_lockouts
  admin_user_id, workspace_id, locked_until

refresh_tokens
  id uuid pk, user_id, token_hash, expires_at, revoked_at nullable

email_verifications, password_resets
  token_hash, user_id, expires_at, consumed_at
```

RLS policies on every workspace-scoped table:
```
USING (workspace_id = current_setting('app.current_workspace_id')::uuid)
```
Admin path uses a `SECURITY DEFINER` function `admin_query(...)` to bypass RLS for cross-Workspace reads.

### API contract (high level)

All routes are TypeScript Netlify Functions under `/.netlify/functions/...` and a thin URL rewrite layer maps friendlier paths. Every authenticated request carries the session cookie; the function reads it via `sessionManager.verify`, opens `tenancyContext`, then dispatches to the relevant module.

Public:
- `POST /auth/google` — verify Google ID token, issue session, redirect to dashboard.
- `POST /auth/email/login`, `POST /auth/email/register`, `POST /auth/email/verify`, `POST /auth/email/reset`
- `POST /auth/refresh`, `POST /auth/logout`

Workspace-scoped (require session + workspace selection):
- `GET /workspaces/:id/products`, `POST /workspaces/:id/products`, `PATCH .../products/:pid`, `DELETE .../products/:pid`
- `POST /workspaces/:id/products/bulk-import`
- `POST /workspaces/:id/stock/movements`
- `GET /workspaces/:id/stock/low`, `/dead`, `/fast`
- `POST /workspaces/:id/exports`, `GET /workspaces/:id/exports`
- `POST /workspaces/:id/backups`, `GET /workspaces/:id/backups`
- `GET /workspaces/:id/files`, `POST /workspaces/:id/files`, `PATCH/DELETE`
- `GET /workspaces/:id/audit`
- `POST /workspaces/:id/team/invite`, `PATCH .../team/:uid`, `DELETE .../team/:uid`

Admin-scoped (require admin + per-Workspace unlock for Workspace ops):
- `GET /admin/workspaces`, `POST /admin/workspaces` (onboard)
- `POST /admin/workspaces/:id/unlock`
- `POST /admin/workspaces/:id/impersonate`, `DELETE /admin/impersonate/:sessionId`
- `POST /admin/system-backup`
- `GET /admin/audit`

Image proxy:
- `GET /api/img/:productId/:driveFileId?variant=thumb|card|full`

Webhook (reserved for v2; designed but not exposed):
- `POST /workspaces/:id/stock/webhook` (X-Webhook-Secret)

### Schema migrations
- All schema changes in `db/migrations/NNN_name.sql`, numbered, idempotent where possible.
- Applied via a Netlify build step on deploy, against the connected Neon branch.

### Image flow (decision-recap)
- Browser → `POST /workspaces/:id/products/:pid/images/upload-init` → Function returns a Drive resumable upload session URL → browser PUTs bytes directly to Drive → `POST .../images/upload-complete` → Function stores `drive_file_id` on the product.
- Display: `<img src="/.netlify/images?url=/api/img/:pid/:fid&w=200">` → Netlify Image CDN → cached 30d at edge.

### God-mode impersonation contract
- Begin: requires `unlockedWorkspaces` contains workspace, a written reason, a target user in that workspace, the admin signed in.
- Session claim: `impersonation = { targetUserId, workspaceId, reason, startedAt, expiresAt }`.
- Every write path receives `actorContext` from `impersonationManager.currentActor`:
  - Business data writes: `updated_by = onBehalfOfId` (the impersonated user).
  - Audit log writes: `actor_user_id = realActorId` (Admin), `on_behalf_of = onBehalfOfId`, `impersonation_reason = reason`.
- Banner UI is driven by the session claim; `Exit` calls `DELETE /admin/impersonate/:id`.
- Destructive actions in impersonated mode trigger a second confirmation modal text-templated with the impersonated user's name.

### Frontend
- Vanilla HTML/CSS/JS, no framework lock-in for v1.
- CSS approach: small custom utility set; we can switch to Tailwind in implementation if it speeds things up. Decision deferred to first UI work.
- Theme: light/dark toggle persisted in `localStorage` + a server-stored preference on profile (the server copy wins on sign-in to a new device).
- A small SPA router handles tab switching within the dashboard; full page reloads only on workspace switch and sign-out.

### Notifications
- All emails sent via Resend with a single sender domain (TBD at first deploy).
- Event-driven: `notificationDispatcher.send(userId, template, vars)` checks the user's preferences before sending.
- In-app toasts via a simple pub/sub; a small bell icon stores the last 30 days of notifications client-side.

### Hub-and-spoke (recap)
- ExSol is the source of truth. No live external integrations in v1.
- A `/api/v1/...` namespace is reserved internally but not exposed publicly — the future Internal Website will be the first consumer.

---

## Testing Decisions

### What makes a good test for this codebase

- **Test external behavior, not implementation.** A test on `permissionPolicy.can(...)` checks the boolean result for many (role, action, resource) combinations. It does NOT check that the implementation uses a particular lookup table, ordering, or internal helper.
- **Tests should keep working through refactors.** If we rewrite `stockLedger`'s SQL today, the test should still pass tomorrow because it only observes "moves in, count out."
- **No mocking of code under test.** Real Postgres (test container) for `tenancyContext` and `stockLedger`. Real session JWT signing key for `sessionManager`. Mock only the external boundary — Google's token-info endpoint, Drive API, Resend.
- **Property-based tests where applicable.** Especially for `stockLedger` (sum-of-deltas invariant under any permutation of inserts).
- **Table-driven tests for the role matrix.** Every (role, action, resource) combination, expected outcome, one line per case.

### Modules with tests in v1 (per chosen tier)

1. **`tenancyContext`** — RLS enforcement. Tests:
   - A query opened under `workspace_id = A` cannot read rows from `workspace_id = B`, regardless of whether the SQL explicitly filters by workspace.
   - The same applies to inserts (rejected) and updates (no rows affected).
   - Admin context can read across workspaces only via the explicit admin-query function.
   - Setting workspace context then forgetting to clear it leaves no leakage into the next transaction.

2. **`permissionPolicy`** — Role matrix. Tests:
   - Table-driven: every (role × action × resource_type) → expected allow/deny. Includes Admin, Primary, Manager, Storekeeper, and "Admin impersonating each".
   - God-mode rules: Admin impersonating a Storekeeper can still take admin-only actions.
   - Cross-workspace: a Primary of Workspace A cannot act on resources in Workspace B even if they happen to be a member of B (RLS plus policy).

5. **`workspaceUnlockManager`** — Tests:
   - Correct key unlocks; wrong key fails.
   - 5 failed attempts in 10 min produce a lockout row + an outbound email call to the dispatcher (mocked).
   - A successful unlock issues a 15-min claim; activity within the window extends it; activity after expiry does not.
   - Rotating the key invalidates existing unlock claims for that workspace immediately.

6. **`impersonationManager`** — Tests:
   - `begin` requires an active unlock and a non-empty reason; missing either fails with a specific error.
   - Session expires at 30 min; `currentActor` returns the impersonation context inside the window and reverts to the real actor outside it.
   - Ending a session removes the claim and writes an audit event with the duration.
   - Cannot begin a second impersonation while one is active.

7. **`auditLogWriter`** — Tests:
   - `record` captures only the changed fields between `before` and `after`; unchanged fields are omitted.
   - When called during impersonation, `actor_user_id = real actor` and `on_behalf_of = target`.
   - A bulk-op call with `bulkSummary: { count, sampleIds }` writes one row, not N.
   - Resource-type and action are validated against an allowed enum.

8. **`stockLedger`** — Tests:
   - `recordMovement` inserts a row and updates `products.stock_count` to `SUM(deltas)`.
   - Property test: any permutation of N movements produces the same final count.
   - `recountToAbsolute(productId, 50)` from a current count of 47 inserts a `recount` movement with delta `+3`.
   - Invalid reason/source values are rejected.
   - Concurrent insert race (two transactions inserting simultaneously) does not double-count or skip rows.

### Modules NOT tested in v1 (out of scope per chosen tier)

`authVerifier`, `sessionManager`, `driveClient`, `imagePipeline`, `exportEngine`, `backupEngine`, `productService`. These get manual UI smoke tests during build. The decision is deliberate: cost ~6 weeks of extra test work; benefit smaller than the data-integrity / security cluster above.

### Test infrastructure
- Test framework: Vitest (TS-first, fast, watches well).
- Postgres test container: `pg-mem` for fast unit tests where SQL surface is small; real Neon ephemeral branch for tests that exercise RLS (the only way to test RLS realistically).
- Mock Google token verification by injecting a `verifyIdToken` dependency.
- Mock Drive client at the seam (`driveClient` interface) when the test exercises a module that depends on it.

### Prior art
- This is a greenfield codebase. No prior tests to mirror. The PRD itself sets the testing direction.

---

## Out of Scope

The following are explicitly out of scope for v1 and intentionally deferred:

- **Live marketplace integrations** — no real-time push/pull with Amazon, Flipkart, WhatsApp Business catalog availability, Meta Commerce, Swiggy, Zomato, Rakuten, AliExpress, Shopify, WooCommerce, Magento. Exports are file-based only.
- **Marketing automation** — Canva ad generation, scheduled WA blasts, dead-stock promotion pipelines.
- **ML / forecasting** — demand prediction, stock-optimization recommendations, smart reorder points. Low/Dead/Fast Movers are SQL queries only.
- **Amazon flat-file export** — category-specific template handling deferred to v2.
- **Internal Website / ERP API** — designed but not exposed; the future Internal Website will be the first consumer and is a separate project.
- **Apple ID, SMS OTP** — auth methods dropped from original brief.
- **Custom OAuth providers (Microsoft, GitHub, etc.)** — not requested.
- **Custom roles per Client** — only Primary / Manager / Storekeeper in v1.
- **Per-Client custom export schemas** — exports are XLSX-comprehensive, CSV-comprehensive, Meta-schema only.
- **File manager advanced features** — no drag-drop, no multi-select, no trash, no file versioning, no share-links.
- **Real-time collaboration** — no live cursors, no simultaneous editing with merge.
- **Multi-language UI** — English only.
- **Native mobile apps** — web-only; mobile browser is supported via responsive design.
- **Currency conversion** — INR is the only configured currency in v1 (the field exists but isn't used for conversion).
- **Tax computation / invoicing** — GST/HSN fields are captured for marketplace exports; ExSol itself does not compute tax invoices.
- **Payment processing** — billing for Clients to Admin happens out-of-band; no Stripe/Razorpay in v1.
- **Public product catalog** — products are not exposed to anonymous web visitors. Only the future custom ecommerce site (consumer) renders them publicly.

---

## Further Notes

- **Migration paths designed in:** Drive → Cloudflare R2 for images (only the `driveClient` and `imagePipeline` modules touched); add Python analytics worker on Railway/Render (only the `exportEngine` / `productService` call sites updated); upgrade Neon to a paid plan (no code change). These are not v1 work; they are documented so v2 doesn't fight the architecture.
- **Single Drive owner account is a known concentration risk.** Mitigations: 2FA on Admin's Google account, a documented recovery procedure for Drive lock-out, and a system backup retained off the same account when feasible. ADR-0001 acknowledges this.
- **God-mode impersonation reversibility:** the schema and audit log are already shaped to support capped "act as" mode if you change your mind in v2. Only the `permissionPolicy.can` function changes; no migrations.
- **Stock-as-ledger is the most future-proof part of the design.** When the Internal Website / ERP comes online, it consumes a stable contract (movements + derived counts) regardless of where the writes originate.
- **The full grilling log is in `docs/grilling-log.md`** for traceability of every decision in this PRD.
