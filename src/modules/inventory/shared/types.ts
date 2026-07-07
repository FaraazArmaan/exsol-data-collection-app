// Shared inventory types, kept in one place so pages, components and tests agree.

export type LifecycleState = 'active' | 'seasonal' | 'discontinued';

export interface StockRow {
  product_id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  qty_on_hand: number;
  reorder_level: number;
  lifecycle_state: LifecycleState;
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

export type ReturnDisposition = 'restock' | 'writeoff';

export interface InventoryReturn {
  id: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  qty: number;
  disposition: ReturnDisposition;
  reason: string | null;
  created_at: string;
}

export interface InventoryKpis {
  total_skus: number;
  total_units: number;
  low_stock_count: number;
  movement_volume_30d: number;
  // Layered on by the Cost Calculator (moving-average valuation), in minor units.
  stock_value_minor?: number | null;
}

export interface DashboardLowStock {
  product_id: string;
  name: string;
  sku: string | null;
  qty_on_hand: number;
  reorder_level: number;
}

export interface DashboardMovement {
  id: string;
  type: string;
  qty_delta: number;
  created_at: string;
  product_name: string;
}

export interface ProductValuation {
  product_id: string;
  name: string;
  qty_on_hand: number;
  unit_cost_minor: number;
  value_minor: number;
}

export interface DashboardData {
  kpis: InventoryKpis;
  lowStock: DashboardLowStock[];
  recentMovements: DashboardMovement[];
  topValue: ProductValuation[];
}

export interface WarehouseLocation {
  id: string;
  name: string;
  kind: string;
}

export interface LocationStock {
  location_id: string;
  location_name: string;
  location_kind: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  qty: number;
}

export interface ByLocationData {
  locations: WarehouseLocation[];
  items: LocationStock[];
}

export interface ProductLocationRow {
  location_id: string;
  location_name: string;
  location_kind: string;
  qty: number;
}

export interface ProductLocations {
  on_hand: number;
  location_total: number;
  by_location: ProductLocationRow[];
}
