-- 137_clients_base_currency.sql — per-client base currency for money formatting.
-- Consumed by the shared currency util (src/lib/currency.ts): modules SELECT
-- base_currency and pass it to formatMoney(minorUnits, code).
-- Additive + idempotent. Default 'INR' — existing clients (incl. papa-s-saloon)
-- inherit it, so the setting demos with no backfill.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS base_currency text NOT NULL DEFAULT 'INR';
