-- Migration 163: seed Inventory's ledger-backed stock from legacy product quantities.
-- Existing inventory rows are already authoritative and are never overwritten.
WITH seeded AS (
  INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand)
  SELECT client_id, id, stock_qty
  FROM public.products
  WHERE type = 'physical' AND deleted_at IS NULL AND stock_qty IS NOT NULL
  ON CONFLICT (client_id, product_id) DO NOTHING
  RETURNING client_id, product_id, qty_on_hand
)
INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref)
SELECT client_id, product_id, qty_on_hand, 'adjustment', 'migration:163 legacy_stock_qty_baseline'
FROM seeded
WHERE qty_on_hand <> 0;
