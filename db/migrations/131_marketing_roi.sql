-- Migration 131: Marketing ROI — per-campaign revenue attribution window.
-- Reserved number 131 (marketing-depth range 131-136).
-- Attribution matches campaign recipients to sales/bookings BY EMAIL (no
-- customer_id FK exists on sales/bookings — POS-v2 storefront guests are plain
-- email/phone rows), within [sent_at, sent_at + attribution_window_days).
alter table public.marketing_campaigns
  add column if not exists attribution_window_days integer not null default 14;
alter table public.marketing_campaigns
  add constraint marketing_campaigns_window_positive check (attribution_window_days between 1 and 365);
-- Attribution joins lower(customer_email); expression indexes keep the per-campaign
-- correlated subqueries cheap as sales/bookings grow.
create index if not exists sales_bucket_email_created_idx
  on public.sales (bucket_id, lower(customer_email), created_at);
create index if not exists bookings_bucket_email_created_idx
  on public.bookings (bucket_id, lower(customer_email), created_at);
