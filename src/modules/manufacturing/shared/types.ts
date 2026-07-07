export type ProductionStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';

export interface BomListItem {
  id: string;
  name: string;
  output_product_id: string;
  output_product_name: string;
  component_count: number;
  created_at: string;
}

export interface BomComponentRow { component_product_id: string; name: string; qty: number; }

export interface BomDetail {
  id: string;
  name: string;
  output_product_id: string;
  output_product_name: string;
  components: BomComponentRow[];
}

export interface ProductionOrder {
  id: string;
  bom_id: string;
  bom_name: string;
  output_product_id: string;
  output_product_name: string;
  qty: number;
  status: ProductionStatus;
  created_at: string;
  completed_at: string | null;
}

export interface ProductPick { product_id: string; name: string; }

export type Priority = 'low' | 'normal' | 'high';

export const PRIORITIES: Priority[] = ['low', 'normal', 'high'];

export interface KanbanOrder {
  id: string;
  bom_id: string;
  bom_name: string;
  output_product_id: string;
  output_product_name: string;
  qty: number;
  status: ProductionStatus;
  board_rank: number;
  priority: Priority;
  due_on: string | null;
  created_at: string;
}

export interface ProductCost { product_id: string; unit_cost_cents: number; }

export interface BomCostComponent {
  product_id: string;
  product_name: string;
  qty: number;
  unit_cost_cents: number;
  line_cents: number;
}

export interface BomCostRollup {
  bom_id: string;
  components: BomCostComponent[];
  total_cents: number;
}

export type QcResult = 'pending' | 'pass' | 'fail';
export type QcDisposition = 'none' | 'scrap' | 'rework';

export interface QcCheck {
  id: string;
  production_order_id: string;
  item: string;
  result: QcResult;
  disposition: QcDisposition;
  scrap_qty: number;
  notes: string | null;
  created_at: string;
}

export interface ConsumptionLot {
  id: string;
  production_order_id: string;
  component_product_id: string;
  component_name: string;
  lot_ref: string;
  qty: number;
  output_product_name: string;
  order_status: ProductionStatus;
  created_at: string;
}

export type MaintKind = 'maintenance' | 'downtime';

export interface MaintLog {
  id: string;
  kind: MaintKind;
  resource_label: string | null;
  reason: string;
  minutes: number;
  occurred_on: string;
  notes: string | null;
  created_at: string;
}

export interface ScrapLog {
  id: string;
  product_id: string;
  product_name: string;
  qty: number;
  reason: string | null;
  occurred_on: string;
  created_at: string;
}

export interface MfgResource {
  id: string;
  name: string;
  hours_per_day: number;
  created_at?: string;
}

export interface CapacitySlot {
  resource_id: string;
  resource_name: string;
  capacity: number;
  day: string;
  booked: number;
  overbooked: boolean;
}
