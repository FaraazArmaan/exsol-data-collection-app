-- Migration 069: Procurement depth — supplier deepen.
-- Adds payment_terms + rating (1-5) to suppliers, and a supplier_contacts child
-- table for multiple named contacts per supplier.
-- Additive + idempotent. One statement per line; comments on their own line.

alter table public.suppliers
  add column if not exists payment_terms text;

alter table public.suppliers
  add column if not exists rating int;

alter table public.suppliers
  drop constraint if exists suppliers_rating_chk;

alter table public.suppliers
  add constraint suppliers_rating_chk check (rating is null or rating between 1 and 5);

create table if not exists public.supplier_contacts (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,
  name         text not null,
  role         text,
  phone        text,
  email        text,
  created_at   timestamptz not null default now(),
  constraint supplier_contacts_name_len check (char_length(name) between 1 and 160)
);

create index if not exists supplier_contacts_supplier_idx
  on public.supplier_contacts (supplier_id);
