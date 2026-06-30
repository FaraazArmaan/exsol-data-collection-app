-- Migration 045: sales.source + nullable created_by_user_node — attribute
-- storefront (guest) sales without polluting the team tree with synthetic
-- user_nodes. A DB-enforced CHECK keeps the invariant honest:
--   pos        sale → has a creator node
--   storefront sale → has no creator node
-- Backfill: existing rows already have created_by_user_node NOT NULL, so the
-- defaulted source='pos' satisfies the CHECK. Additive (no destructive reorder).
-- See docs/superpowers/specs/2026-06-29-pos-v2-storefront-design.md §4.3.

alter table public.sales
  alter column created_by_user_node drop not null;

alter table public.sales
  add column if not exists source text not null default 'pos'
    check (source in ('pos', 'storefront'));

alter table public.sales
  add constraint sales_source_attribution_consistent check (
    (source = 'pos'        and created_by_user_node is not null) or
    (source = 'storefront' and created_by_user_node is null)
  );

create index if not exists idx_sales_bucket_source
  on public.sales (bucket_id, source, created_at desc);
