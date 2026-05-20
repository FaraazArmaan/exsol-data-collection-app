# ADR 0006: Pivot File Storage from Google Drive to Netlify Blobs

- **Status:** Accepted
- **Date:** 2026-05-20
- **Supersedes:** the file-storage portion of ADR-0001 ("Google Drive (via Drive API, on the owner's existing 15 GB account)") and ADR-0005's storage layer choices. Drive is no longer in the v1 architecture.

## Context

ADR-0001 chose Google Drive as the v1 file storage backend, leveraging the owner's existing 15 GB free quota and Drive's familiar file-manager UI. ADR-0005 elaborated on folder layout, backup format, and retention. Module 9 (`driveClient`) and Module 10 (`imagePipeline`) were built against this assumption.

During the first end-to-end smoke test on 2026-05-20, the Drive integration hit two unrelated failure modes in sequence:

1. **Browser-direct resumable upload was CORS-blocked.** The Drive REST API issues a resumable session URL that is only CORS-allowed if the initiating PATCH request includes an `Origin` header. Node's `undici` fetch (the built-in implementation in Node 22) silently drops `Origin` because the WHATWG Fetch spec lists it as a "forbidden request header." There was no way to make Google issue a CORS-enabled session URL from a Node-based serverless function without dropping below the fetch API to raw HTTP.

2. **Server-side multipart upload (the workaround) hit a hard wall:** *"Service Accounts do not have storage quota. Leverage shared drives, or use OAuth delegation instead."* Service accounts cannot own files; on consumer Gmail this is fatal. Google's two recommended fixes are:
   - **Shared Drives** — available only on paid Google Workspace ($6/user/month).
   - **OAuth domain-wide delegation** — also requires Workspace.

   The non-Workspace alternative is **per-user OAuth delegation**: expand the existing Google sign-in flow to request a `drive.file` scope, switch from ID-token verification to the authorization-code flow, persist per-user refresh tokens, and call Drive on behalf of the user. This is real surgery on the auth path (~1–2 hours of careful changes) on top of a Friday production deadline.

We needed a v1 storage backend that:
- Does not require paid Workspace.
- Has no CORS dance for uploads.
- Has no OAuth refactor.
- Is reachable from Netlify Functions.

## Decision

**Adopt Netlify Blobs as the v1 file storage backend for all of: product images, exports, and backups.**

Implementation:
- `@netlify/blobs` package, `getStore({ name: '<store>' })` API.
- Stores: `product-images` (already in use), `product-exports` and `workspace-backups` / `system-backups` (planned for Modules 11–12).
- Upload path: browser → Netlify Function (multipart POST) → `blobStorage.putImage` → returns opaque key → stored on `products.primary_image_id` / `extra_image_ids`.
- Read path: `<img src="/.netlify/images?url=/api/img/<pid>/<key>&w=...">` → Netlify Image CDN → on cache miss, calls `/api/img/:pid/:fid` → `blobStorage.getImage` → streams bytes.
- Keys: `${workspaceId}_${productId}_${uuidv4()}`, underscore-joined so they survive a single URL path segment without escaping. Schema migration `009_rename_image_columns.sql` renamed the DB columns to drop the backend-specific `drive_id` suffix.

## Consequences

### Operational

- **No service-account JSON to manage** in `.env` or Netlify env. Blobs is auto-provisioned per Netlify site.
- **Local dev "just works":** `netlify dev` provides a sandboxed local Blobs store; no setup needed.
- **No Drive folder bookkeeping** (workspace folders, per-product subfolders, file permissions). Files are opaque, keyed by `workspace_product_uuid`.

### Constraints

- **5 MB per-file upload cap** for v1. Netlify Functions have a 6 MB body limit, and the multipart envelope eats a small overhead. Real-world product photos from modern phones (1–3 MB JPEG) sit comfortably under this; raw camera files (20 MB+) do not. Documented in the upload UI ("up to 5 MB") and enforced both client- and server-side.
- **No user-browsable Drive UI.** The original v1 appeal of Drive (the owner can open their Drive and see all product images organized by workspace) is gone. Files are accessed via the app only.
- **Vendor lock-in to Netlify.** If we leave Netlify, file data has to be exported/migrated. Acceptable v1 trade-off given the rest of the stack (Functions, Image CDN) is already Netlify-bound.

### Future-proofing

- The column rename (`drive_id` → `id`) treats values as opaque keys, so a third-party storage swap (S3, R2, Backblaze B2) does not require another migration.
- If image upload limits ever matter, two non-exclusive paths exist:
  - **Signed-URL direct upload** to Blobs (Netlify Blobs supports this via `getStore().getUrl({ ... })`). Would let the browser upload directly without going through a Function, lifting the 5 MB cap.
  - **Per-user Google OAuth delegation** (the path we did NOT take in v1). Would let the user's own Drive hold files and lift v1's vendor lock-in concerns.

### Cost

- **Free tier** of Netlify Blobs is generous (100 GB on Pro; the Starter free plan has a smaller allowance — verify at deploy time).
- Replaces the conceptual "owner's 15 GB Drive" with "Netlify's pooled storage." Net-net for v1 expected usage (single-digit clients × ~100 products × ~3 images each × 1 MB ≈ <5 GB), well within free tier.

## Alternatives considered (and rejected)

- **Stay on Drive with per-user OAuth delegation.** Real but heavy. Touches auth (which is the most tested module so far), introduces refresh-token lifecycle bugs, and the user-facing consent prompt adds a step to onboarding. ~1–2 hours minimum, with non-trivial regression risk against the Friday deadline.
- **Drop image upload entirely from v1.** The product editor and listing both have image-shaped real-estate; gutting them is a visible loss to the boss demo.
- **S3 / Cloudflare R2.** Either works, but adds a new vendor + SDK + env management for marginal benefit over Netlify Blobs given the rest of the stack is Netlify.
- **Store images in Postgres as `bytea`.** Doesn't scale (Postgres row size limits, backup bloat, slow reads) and Neon's serverless pricing makes byte traffic expensive.

## Rollback plan

The pivot is contained: `blob-storage.ts` is the only module that talks to Netlify Blobs, and migration 009 is reversible (rename the columns back, restore `drive-client.ts` from `git show 8ce82c7:src/lib/drive-client.ts`). If a Friday production issue surfaces with Blobs, the fallback is to defer image upload entirely (the editor still works without images via the SKU-letter placeholder).
