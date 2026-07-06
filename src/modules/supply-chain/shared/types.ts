export type SectionKey = 'inventory' | 'procurement' | 'manufacturing';

export interface InventoryResponse {
  kpis: { lowStockCount: number; movementVolume30d: number };
  lowStock: {
    productId: string; name: string; sku: string | null;
    qtyOnHand: number; reorderLevel: number; deficit: number;
  }[];
  movementSeries: { day: string; volume: number }[];
  generatedAt: string;
}

export interface ProcurementResponse {
  kpis: { openPoCount: number; openValueCents: number };
  openPos: {
    id: string; supplier: string; status: string; expectedOn: string | null;
    itemCount: number; totalCents: number;
  }[];
  generatedAt: string;
}

export interface ManufacturingResponse {
  kpis: { inProgressCount: number; unitsInProduction: number };
  orders: { id: string; product: string; bomName: string; qty: number; createdAt: string }[];
  generatedAt: string;
}
