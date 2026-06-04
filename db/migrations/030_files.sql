-- Migration 030: files — central table for the File Manager module.
-- See docs/superpowers/specs/2026-06-04-file-manager-design.md §4.1.

CREATE TYPE file_type         AS ENUM ('document', 'image', 'video', 'audio', 'external');
CREATE TYPE file_storage_kind AS ENUM ('blob', 'url');
CREATE TYPE file_tier         AS ENUM ('public', 'role', 'restricted', 'confidential');

CREATE TABLE public.files (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  type                  file_type NOT NULL,
  storage_kind          file_storage_kind NOT NULL,
  blob_key              text,
  external_url          text,
  external_provider     text,
  title                 text NOT NULL,
  description           text,
  filename              text,
  mime                  text,
  byte_size             bigint,
  thumbnail_key         text,
  tier                  file_tier NOT NULL DEFAULT 'public',
  uploaded_by_user_node uuid REFERENCES public.user_nodes(id),
  uploaded_by_admin     uuid REFERENCES public.admins(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT files_storage_kind_consistent CHECK (
    (storage_kind = 'blob' AND blob_key IS NOT NULL AND external_url IS NULL) OR
    (storage_kind = 'url'  AND external_url IS NOT NULL AND blob_key IS NULL)
  ),
  CONSTRAINT files_uploader_consistent CHECK (
    (uploaded_by_admin IS NOT NULL) <> (uploaded_by_user_node IS NOT NULL)
  )
);

CREATE INDEX files_client_type_idx
  ON public.files (client_id, type) WHERE deleted_at IS NULL;
CREATE INDEX files_client_created_idx
  ON public.files (client_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX files_tier_idx
  ON public.files (tier) WHERE deleted_at IS NULL;
