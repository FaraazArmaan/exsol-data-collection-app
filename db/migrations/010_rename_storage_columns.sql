-- 010_rename_storage_columns.sql
--
-- Same rename done by migration 009 (products.primary_image_drive_id →
-- primary_image_id), now extended to the rest of the file-storage tables.
-- Module 11 (exportEngine) and Module 12 (backupEngine) write to Netlify
-- Blobs, not Drive. See ADR-0006.
--
-- The `files` table is for the v1.1 user-facing file manager UI; we don't
-- expose it in v1 but rename its columns now so the schema stays
-- backend-agnostic.

ALTER TABLE files RENAME COLUMN drive_file_id TO blob_key;
ALTER TABLE files RENAME COLUMN drive_folder_path TO folder_path;
ALTER INDEX idx_files_folder RENAME TO idx_files_folder_path;

ALTER TABLE export_jobs RENAME COLUMN drive_file_id TO blob_key;

ALTER TABLE backups RENAME COLUMN drive_file_id TO blob_key;
