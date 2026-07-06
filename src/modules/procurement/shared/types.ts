// Shared procurement types. Note: BIGINT columns (unit_cost_cents, total_cents)
// come back from Neon as strings — coerce with Number() before math/formatting.

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export type POStatus = 'draft' | 'ordered' | 'received' | 'cancelled';

export interface PurchaseOrderRow {
  id: string;
  status: POStatus;
  expected_on: string | null;
  received_at: string | null;
  created_at: string;
  supplier_name: string;
  item_count: number;
  total_cents: number | string;
}

export interface PurchaseOrderDetail {
  id: string;
  status: POStatus;
  expected_on: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
  supplier_id: string;
  supplier_name: string;
}

export interface PurchaseOrderItem {
  id: string;
  product_id: string;
  product_name: string;
  qty: number;
  unit_cost_cents: number | string;
}

export interface ProductPick {
  id: string;
  name: string;
  sku: string | null;
}

export type POAction = 'order' | 'receive' | 'cancel';
