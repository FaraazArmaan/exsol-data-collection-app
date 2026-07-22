// Shared Orders types — wire types returned by orders endpoints.
// Kept here so pages, components and tests all agree on the shape.

export type SaleStatus = 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
export type SaleChannel = 'instore' | 'online' | 'pickup';

export interface StatusRow {
  status: SaleStatus;
  n: number;
  cents: number;
}

export interface ChannelRow {
  channel: SaleChannel;
  n: number;
  cents: number;
}

export interface OpenSummary {
  n: number;
  cents: number;
}

export interface OrdersDashboardData {
  base_currency: string;
  by_status: StatusRow[];
  by_channel: ChannelRow[];
  open: OpenSummary;
  avg_fulfil_secs: number;
  backorders_active: number;
  sla_breaches: number;
}

// ── Operations queue ────────────────────────────────────────────────────────

export type OrdersOperationalState =
  | 'awaiting_payment'
  | 'ready_for_fulfilment'
  | 'fulfilment_in_progress'
  | 'partially_fulfilled'
  | 'remaining_cancelled'
  | 'cancelled'
  | 'fulfilled';

export interface OrderQueueRow {
  id: string;
  order_no: number;
  sale_status: SaleStatus;
  channel: Exclude<SaleChannel, 'instore'>;
  customer_name: string;
  total_cents: number;
  created_at: string;
  paid_at: string | null;
  ordered_qty: number;
  fulfilled_qty: number;
  cancelled_qty: number;
  remaining_qty: number;
  operational_state: OrdersOperationalState;
  refund_state: RefundState | null;
}

export interface OrdersQueueData {
  base_currency: string;
  orders: OrderQueueRow[];
}

// ── Refunds ──────────────────────────────────────────────────────────────────

export type RefundState = 'requested' | 'approved' | 'rejected' | 'completed';

export interface RefundRow {
  id: string;
  sale_id: string;
  amount_cents: number;
  reason: string | null;
  state: RefundState;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  provider_refund_status: 'pending' | 'succeeded' | 'failed' | 'void' | null;
  order_no: number;
  customer_name: string;
}

export interface RefundAdvanceResult {
  id: string;
  state: RefundState;
  sale_refunded: boolean;
  provider_pending?: boolean;
}

// ── Shipments ─────────────────────────────────────────────────────────────────

export type ShipmentStatus = 'pending' | 'shipped' | 'in_transit' | 'delivered' | 'returned';

export interface ShipmentRow {
  id: string;
  sale_id: string;
  carrier: string | null;
  tracking_ref: string | null;
  status: ShipmentStatus;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  order_no: number;
  customer_name: string;
}

export interface PickupRow {
  id: string;
  sale_id: string;
  status: 'ready' | 'collected';
  ready_at: string;
  collected_at: string | null;
  collector_name: string | null;
  collector_phone_last4: string | null;
  order_no: number;
  customer_name: string;
}

// ── SLA ───────────────────────────────────────────────────────────────────────

export type OrderStage =
  | 'pending_payment'
  | 'paid'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded'
  | 'picking'
  | 'packing'
  | 'shipped'
  | 'delivered'
  | 'backordered';

export interface SlaTarget {
  stage: OrderStage;
  max_minutes: number;
}

export interface SlaBreach {
  sale_id: string;
  order_no: number;
  stage: string;
  minutes: number;
  max_minutes: number;
}

export interface SlaData {
  targets: SlaTarget[];
  breaches: SlaBreach[];
  breach_count: number;
}

// ── Backorders ────────────────────────────────────────────────────────────────

export type BackorderStatus = 'queued' | 'partially_fulfilled' | 'fulfilled' | 'cancelled';

export interface BackorderRow {
  id: string;
  sale_id: string;
  product_id: string;
  product_name_snap: string;
  qty_ordered: number;
  qty_fulfilled: number;
  status: BackorderStatus;
  created_at: string;
  updated_at: string;
  fulfilled_at: string | null;
}

export interface BackorderFulfillResult {
  id: string;
  status: BackorderStatus;
  qty_fulfilled: number;
}

// ── Fulfillments (Split) ──────────────────────────────────────────────────────

export type FulfillmentStatus = 'pending' | 'picked' | 'packed' | 'shipped' | 'fulfilled' | 'cancelled';

export interface FulfillmentLineRow {
  id: string;
  sale_line_id: string;
  qty: number;
  product_name_snap: string;
  unit_price_cents: number;
  line_qty: number;
  fulfilled_qty: number;
  remaining_qty: number;
  shipped_qty: number;
}

export interface FulfillmentRow {
  id: string;
  sale_id: string;
  label: string;
  status: FulfillmentStatus;
  created_at: string;
  updated_at: string;
  fulfilled_at: string | null;
  lines: FulfillmentLineRow[];
}

export interface FulfillmentAdvanceResult {
  id: string;
  status: FulfillmentStatus;
  fulfilled_at?: string | null;
}

// ── Merge Groups ──────────────────────────────────────────────────────────────

export interface MergeGroupResult {
  group_id: string;
}

// ── Sale Lines (split allocator source) ──────────────────────────────────────

export interface SaleLineItem {
  id: string;
  product_id: string;
  product_name_snap: string;
  qty: number;
}

export interface SaleLinesResult {
  sale: { id: string; order_no: number; customer_name: string };
  lines: SaleLineItem[];
}
