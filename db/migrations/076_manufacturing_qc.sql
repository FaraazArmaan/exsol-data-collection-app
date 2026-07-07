-- Migration 076: Manufacturing Quality Control — per-order QC checklists with a
-- fail disposition (scrap or rework). Each check is a line item on a production
-- order; recording 'fail' + 'scrap' writes a stock_movements adjustment against the
-- output product (removes defective units from stock via the existing ledger).
-- 'rework' records the decision for the shop floor without touching stock.
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).

create table if not exists public.manufacturing_qc_checks (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.clients(id) on delete cascade,
  production_order_id  uuid not null references public.production_orders(id) on delete cascade,
  item                 text not null,
  result               text not null default 'pending',
  disposition          text not null default 'none',
  scrap_qty            int not null default 0,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint manufacturing_qc_result_chk check (result in ('pending', 'pass', 'fail')),
  constraint manufacturing_qc_disp_chk check (disposition in ('none', 'scrap', 'rework')),
  constraint manufacturing_qc_scrap_nonneg check (scrap_qty >= 0),
  constraint manufacturing_qc_item_len check (char_length(item) between 1 and 200)
);

create index if not exists manufacturing_qc_order_idx
  on public.manufacturing_qc_checks (client_id, production_order_id);

drop trigger if exists manufacturing_qc_updated_at on public.manufacturing_qc_checks;

create trigger manufacturing_qc_updated_at
  before update on public.manufacturing_qc_checks
  for each row execute function public.set_updated_at();
