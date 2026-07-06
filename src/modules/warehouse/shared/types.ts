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
