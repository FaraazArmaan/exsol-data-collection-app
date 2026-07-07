-- Migration 094: Inbound ASN (Advance Shipment Notice) — expected vs received.
-- An ASN is a heads-up that a shipment is inbound, optionally linked to a purchase
-- order (Procurement, migration 056), carrying expected quantities per product.
-- Recording receipt captures received_qty per line for variance reporting; it is a
-- reconciliation layer and does NOT mutate inventory_stock (the PO receive flow in
-- Procurement owns the stock increment — this avoids double counting).
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).

create table if not exists public.inbound_asns (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  purchase_order_id  uuid references public.purchase_orders(id) on delete set null,
  reference          text not null,
  carrier            text,
  eta                date,
  status             text not null default 'pending',
  notes              text,
  created_by         uuid references public.user_nodes(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint inbound_asns_status_chk check (status in ('pending', 'received', 'cancelled')),
  constraint inbound_asns_reference_len check (char_length(reference) between 1 and 160)
);

create index if not exists inbound_asns_client_status_idx
  on public.inbound_asns (client_id, status);

create table if not exists public.asn_lines (
  id            uuid primary key default gen_random_uuid(),
  asn_id        uuid not null references public.inbound_asns(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete restrict,
  expected_qty  int not null,
  received_qty  int not null default 0,
  created_at    timestamptz not null default now(),
  constraint asn_lines_expected_pos check (expected_qty > 0),
  constraint asn_lines_received_nonneg check (received_qty >= 0),
  constraint asn_lines_asn_product_uniq unique (asn_id, product_id)
);

create index if not exists asn_lines_asn_idx
  on public.asn_lines (asn_id);

drop trigger if exists inbound_asns_updated_at on public.inbound_asns;

create trigger inbound_asns_updated_at
  before update on public.inbound_asns
  for each row execute function public.set_updated_at();
