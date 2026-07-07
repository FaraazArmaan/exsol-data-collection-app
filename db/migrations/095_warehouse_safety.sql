-- Migration 095: Warehouse Safety Management — incident log + recurring checklists.
-- safety_incidents: a dated, severity-graded log of workplace incidents, optionally
-- tied to a location, opened then closed. safety_checklists: recurring checks with a
-- cadence; safety_checklist_signoffs records each completion so "when due" is derived
-- from the latest signoff vs the cadence. Standalone (no cross-module deps).
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).

create table if not exists public.safety_incidents (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  occurred_on  date not null default current_date,
  severity     text not null default 'low',
  location_id  uuid references public.warehouse_locations(id) on delete set null,
  title        text not null,
  description  text,
  status       text not null default 'open',
  reported_by  uuid references public.user_nodes(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint safety_incidents_severity_chk check (severity in ('low', 'medium', 'high')),
  constraint safety_incidents_status_chk check (status in ('open', 'closed')),
  constraint safety_incidents_title_len check (char_length(title) between 1 and 200)
);

create index if not exists safety_incidents_client_status_idx
  on public.safety_incidents (client_id, status, occurred_on desc);

create table if not exists public.safety_checklists (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  title       text not null,
  cadence     text not null default 'weekly',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint safety_checklists_cadence_chk check (cadence in ('daily', 'weekly', 'monthly')),
  constraint safety_checklists_title_len check (char_length(title) between 1 and 200)
);

create index if not exists safety_checklists_client_idx
  on public.safety_checklists (client_id);

create table if not exists public.safety_checklist_signoffs (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references public.safety_checklists(id) on delete cascade,
  signed_by     uuid references public.user_nodes(id) on delete set null,
  notes         text,
  signed_at     timestamptz not null default now()
);

create index if not exists safety_signoffs_checklist_idx
  on public.safety_checklist_signoffs (checklist_id, signed_at desc);

drop trigger if exists safety_incidents_updated_at on public.safety_incidents;

create trigger safety_incidents_updated_at
  before update on public.safety_incidents
  for each row execute function public.set_updated_at();

drop trigger if exists safety_checklists_updated_at on public.safety_checklists;

create trigger safety_checklists_updated_at
  before update on public.safety_checklists
  for each row execute function public.set_updated_at();
