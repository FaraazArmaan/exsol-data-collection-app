// Shared Warehouse types, kept in one place so pages, components and tests agree.

export type LocationKind = 'warehouse' | 'store' | 'storage' | 'other';

export const LOCATION_KINDS: LocationKind[] = ['warehouse', 'store', 'storage', 'other'];

export const KIND_LABEL: Record<LocationKind, string> = {
  warehouse: 'Warehouse',
  store: 'Store',
  storage: 'Storage',
  other: 'Other',
};

export interface WarehouseLocation {
  id: string;
  name: string;
  kind: LocationKind;
  created_at: string;
}

export interface StockRow {
  location_id: string;
  location_name: string;
  location_kind: LocationKind;
  product_id: string;
  product_name: string;
  sku: string | null;
  qty: number;
}

export interface TransferResult {
  product_id: string;
  from: { location_id: string; qty: number };
  to: { location_id: string; qty: number };
}

export type PutawayStatus = 'pending' | 'done' | 'cancelled';

export interface PutawayTask {
  id: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  qty: number;
  status: PutawayStatus;
  purchase_order_id: string | null;
  location_id: string | null;
  location_name: string | null;
  created_at: string;
  done_at: string | null;
}

export interface WarehouseProduct {
  product_id: string;
  product_name: string;
  sku: string | null;
}

export type AsnStatus = 'pending' | 'received' | 'cancelled';

export interface AsnSummary {
  id: string;
  reference: string;
  carrier: string | null;
  eta: string | null;
  status: AsnStatus;
  purchase_order_id: string | null;
  created_at: string;
  line_count: number;
  total_expected: number;
  total_received: number;
}

export interface AsnLine {
  id: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  expected_qty: number;
  received_qty: number;
  variance: number;
}

export interface AsnDetail {
  asn: {
    id: string;
    reference: string;
    carrier: string | null;
    eta: string | null;
    status: AsnStatus;
    purchase_order_id: string | null;
    notes: string | null;
    created_at: string;
  };
  lines: AsnLine[];
}

export type Severity = 'low' | 'medium' | 'high';
export type IncidentStatus = 'open' | 'closed';

export const SEVERITIES: Severity[] = ['low', 'medium', 'high'];

export interface SafetyIncident {
  id: string;
  occurred_on: string;
  severity: Severity;
  status: IncidentStatus;
  title: string;
  description: string | null;
  location_id: string | null;
  location_name?: string | null;
  created_at: string;
}

export type Cadence = 'daily' | 'weekly' | 'monthly';

export const CADENCES: Cadence[] = ['daily', 'weekly', 'monthly'];

export interface SafetyChecklist {
  id: string;
  title: string;
  cadence: Cadence;
  active: boolean;
  created_at: string;
  last_signed_at: string | null;
  due: boolean;
}

export type SlottingStatus = 'pending' | 'applied' | 'dismissed';

export interface SlottingSuggestion {
  id: string;
  product_id: string;
  product_name: string;
  from_location_id: string;
  from_name: string;
  to_location_id: string;
  to_name: string;
  suggested_qty: number;
  velocity: number;
  rationale: string;
  ai_fallback: boolean;
  status: SlottingStatus;
  created_at: string;
}
