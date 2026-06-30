-- Migration 046: workspace_storage_quota — per-client storage budget.
-- See docs/superpowers/specs/2026-06-04-file-manager-design.md section 4.7.
-- (Renumbered from spec's 036; 036-045 were taken by other modules.)
-- bytes_used_cached is for the header meter only; authoritative usage is
-- recomputed on every upload commit (see _shared/files-quota.ts).

CREATE TABLE public.workspace_storage_quota (
  client_id          uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  byte_limit         bigint NOT NULL DEFAULT 5368709120,
  bytes_used_cached  bigint NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
