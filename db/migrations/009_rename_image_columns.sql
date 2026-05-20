-- 009_rename_image_columns.sql
--
-- Rename the product image columns to drop the storage-backend prefix
-- ("drive") now that the v1 file backend has pivoted to Netlify Blobs.
-- The column type stays text — the *value* is now a Blobs key of the form
-- `<workspaceId>/<productId>/<uuid>` instead of a Drive file ID. The
-- columns are opaque storage references, so renaming makes the schema
-- future-proof against another backend swap.
--
-- Existing values (from any test products created against the Drive path)
-- become invalid — those keys point at Drive file IDs no longer reachable
-- by the app. We don't bother clearing them; they'll 404 on the proxy and
-- the user can re-upload.

ALTER TABLE products RENAME COLUMN primary_image_drive_id TO primary_image_id;
ALTER TABLE products RENAME COLUMN extra_image_drive_ids  TO extra_image_ids;
