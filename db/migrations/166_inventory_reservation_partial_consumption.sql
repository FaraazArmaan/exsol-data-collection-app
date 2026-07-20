-- Migration 166: retain the original reservation while Orders consumes it across partial fulfillments.
ALTER TABLE public.inventory_reservations ADD COLUMN qty_consumed int NOT NULL DEFAULT 0;
ALTER TABLE public.inventory_reservations ADD CONSTRAINT inventory_reservations_qty_consumed_valid CHECK (qty_consumed >= 0 AND qty_consumed <= qty);
