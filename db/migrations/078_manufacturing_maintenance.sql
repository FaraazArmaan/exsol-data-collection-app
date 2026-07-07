-- Migration 078: Manufacturing Maintenance / Downtime / Scrap tracking.
-- maintenance_logs records shop-floor maintenance + unplanned downtime (with a
-- reason and duration) — the 'business' bucket, not product stock. scrap_logs
-- records scrapped product quantities; the scrap endpoint also writes a
-- type='adjustment' stock_movements row so scrap flows through the same ledger.
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).

create table if not exists public.manufacturing_maintenance_logs (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  kind            text not null default 'maintenance',
  resource_label  text,
  reason          text not null,
  minutes         int not null default 0,
  occurred_on     date not null default current_date,
  notes           text,
  created_by      uuid references public.user_nodes(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint manufacturing_maint_kind_chk check (kind in ('maintenance', 'downtime')),
  constraint manufacturing_maint_minutes_nonneg check (minutes >= 0),
  constraint manufacturing_maint_reason_len check (char_length(reason) between 1 and 200)
);

create index if not exists manufacturing_maint_client_idx
  on public.manufacturing_maintenance_logs (client_id, occurred_on desc);

create table if not exists public.manufacturing_scrap_logs (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  qty          int not null,
  reason       text,
  occurred_on  date not null default current_date,
  created_by   uuid references public.user_nodes(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint manufacturing_scrap_qty_pos check (qty > 0)
);

create index if not exists manufacturing_scrap_client_idx
  on public.manufacturing_scrap_logs (client_id, occurred_on desc);
