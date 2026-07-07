// Shared procurement types. Note: BIGINT columns (unit_cost_cents, total_cents)
// come back from Neon as strings — coerce with Number() before math/formatting.

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  payment_terms: string | null;
  rating: number | null;
}

export interface SupplierContact {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

export type POStatus = 'draft' | 'pending_approval' | 'ordered' | 'received' | 'cancelled';

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

export interface SupplierPrice {
  product_id: string;
  product_name: string;
  unit_cost_cents: number | string;
  effective_from: string;
}

export interface PriceHistoryRow {
  id: string;
  unit_cost_cents: number | string;
  effective_from: string;
}

export type POAction = 'order' | 'approve' | 'reject' | 'receive' | 'cancel';

export interface MatchLine {
  product_id: string;
  product_name: string;
  ordered_qty: number;
  received_qty: number;
  unit_cost_cents: number;
  line_total_cents: number;
  qty_ok: boolean;
}

export interface ThreeWayMatch {
  po_total_cents: number;
  invoiced_total_cents: number;
  received_recorded: boolean;
  invoice_recorded: boolean;
  qty_ok: boolean;
  amount_ok: boolean;
  matched: boolean;
  expensed: boolean;
  expense_id: string | null;
  lines: MatchLine[];
  mismatches: Array<{ type: string; detail?: string }>;
}

export interface SupplierInvoice {
  id: string;
  invoice_number: string;
  amount_cents: number | string;
  invoice_date: string;
}

export interface SpendBucket {
  name: string;
  total_cents: number;
}
export interface SpendPoint {
  month: string;
  total_cents: number;
}
export interface SpendData {
  bySupplier: SpendBucket[];
  byCategory: SpendBucket[];
  overTime: SpendPoint[];
}
