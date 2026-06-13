-- Migration 041: sale_lines — one row per cart line, with snapshot pricing.
-- See docs/superpowers/specs/2026-06-12-pos-module-design.md.
-- product_name_snap + unit_price_cents are frozen at sale-create time so
-- later product edits don't rewrite history. line_total_cents is checked
-- for consistency. sale_id cascades (deleting a sale removes its lines);
-- product_id restricts (can't delete a product referenced by a sold line).

create table public.sale_lines (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid not null references public.sales(id)    on delete cascade,
  product_id          uuid not null references public.products(id) on delete restrict,
  product_name_snap   text   not null,
  unit_price_cents    bigint not null,
  qty                 int    not null check (qty > 0),
  line_total_cents    bigint not null,
  position            int    not null,
  created_at          timestamptz not null default now(),
  constraint sale_lines_total_matches check (line_total_cents = unit_price_cents * qty)
);

create index idx_sale_lines_sale on public.sale_lines(sale_id, position);
