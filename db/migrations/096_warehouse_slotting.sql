-- Migration 096: AI Warehouse — slotting suggestions with a human-confirm audit trail.
-- Candidates are derived deterministically from movement velocity (stock_movements)
-- and current allocation (stock_by_location); the lib/ai.ts seam writes the natural
-- language rationale. A suggestion is pending until a human applies it (which runs a
-- real location transfer) or dismisses it — so the AI never mutates stock on its own.
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).

create table if not exists public.warehouse_slotting_suggestions (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete cascade,
  from_location_id  uuid not null references public.warehouse_locations(id) on delete cascade,
  to_location_id    uuid not null references public.warehouse_locations(id) on delete cascade,
  suggested_qty     int  not null,
  velocity          int  not null default 0,
  rationale         text not null default '',
  ai_fallback       boolean not null default true,
  status            text not null default 'pending',
  decided_by        uuid references public.user_nodes(id) on delete set null,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  constraint warehouse_slotting_status_chk check (status in ('pending', 'applied', 'dismissed')),
  constraint warehouse_slotting_qty_pos check (suggested_qty > 0)
);

create index if not exists warehouse_slotting_client_status_idx
  on public.warehouse_slotting_suggestions (client_id, status, velocity desc);
