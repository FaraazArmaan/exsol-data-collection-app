CREATE TABLE files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  drive_file_id     text NOT NULL,
  drive_folder_path text NOT NULL,
  filename          text NOT NULL,
  mime              text NOT NULL,
  size_bytes        bigint NOT NULL,
  uploaded_by       uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX idx_files_folder ON files(workspace_id, drive_folder_path);
CREATE INDEX idx_files_live ON files(workspace_id) WHERE deleted_at IS NULL;

CREATE TYPE export_profile AS ENUM (
  'xlsx_comprehensive', 'csv_comprehensive', 'meta_catalog_csv'
);
CREATE TYPE job_status AS ENUM ('queued', 'running', 'done', 'failed');

CREATE TABLE export_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requester_id  uuid NOT NULL REFERENCES users(id),
  profile       export_profile NOT NULL,
  filter        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        job_status NOT NULL DEFAULT 'queued',
  drive_file_id text,
  error         text,
  queued_at     timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

CREATE INDEX idx_export_jobs_workspace ON export_jobs(workspace_id, queued_at DESC);
CREATE INDEX idx_export_jobs_queued ON export_jobs(status) WHERE status = 'queued';

CREATE TYPE backup_kind AS ENUM ('workspace', 'system');
CREATE TYPE backup_retention_class AS ENUM ('rolling', 'monthly');

CREATE TABLE backups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  kind              backup_kind NOT NULL,
  drive_file_id     text,
  size_bytes        bigint,
  retention_class   backup_retention_class NOT NULL DEFAULT 'rolling',
  triggered_by      uuid REFERENCES users(id),
  status            job_status NOT NULL DEFAULT 'queued',
  error             text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_backups_workspace ON backups(workspace_id, created_at DESC);
CREATE INDEX idx_backups_kind ON backups(kind, created_at DESC);
