// Shared inventory types, kept in one place so pages, components and tests agree.

export interface StockRow {
  product_id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  qty_on_hand: number;
  reorder_level: number;
  low: boolean;
}

export type MovementType = 'sale' | 'purchase' | 'adjustment' | 'production' | 'transfer';

export interface Movement {
  id: string;
  qty_delta: number;
  type: MovementType;
  ref: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AdjustResult {
  product_id: string;
  qty_on_hand: number;
}
