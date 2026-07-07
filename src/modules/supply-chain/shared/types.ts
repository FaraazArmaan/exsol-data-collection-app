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

export interface ProductSupplierLink {
  id: string;
  supplierId: string;
  supplierName: string;
  leadTimeDays: number;
  unitCostCents: number;
  isPrimary: boolean;
}

export interface SuggestedAlternate {
  supplierId: string;
  supplierName: string;
  leadTimeDays: number;
}

export interface SupplierLinksResponse {
  links: ProductSupplierLink[];
  suggestedAlternate: SuggestedAlternate | null;
}

export interface ProductWithSuppliers {
  productId: string;
  name: string;
  supplierCount: number;
  primarySupplier: string | null;
}

export interface ProductsWithSuppliersResponse {
  productsWithSuppliers: ProductWithSuppliers[];
}

export interface CreateSupplierLinkBody {
  productId: string;
  supplierId: string;
  leadTimeDays: number;
  unitCostCents: number;
  isPrimary: boolean;
}

export interface CreateSupplierLinkResponse {
  id: string;
  productId: string;
  supplierId: string;
  leadTimeDays: number;
  unitCostCents: number;
  isPrimary: boolean;
}

export type DrillType = 'product-movements' | 'po-items' | 'production-bom';

export interface MovementRow { date: string; type: string; qtyDelta: number; ref: string | null; }
export interface PoItemRow { product: string; qty: number; unitCostCents: number; lineTotalCents: number; }
export interface BomRow { component: string; qty: number; }

export type DrillRow = MovementRow | PoItemRow | BomRow;
export interface DrillResponse { rows: DrillRow[]; }

export interface RiskItem {
  id: string;
  kind: 'single_supplier' | 'lead_time_collision' | 'overdue_po';
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  productId?: string;
  supplierId?: string;
  poId?: string;
  suggestedAlternate?: { supplierId: string; supplierName: string; leadTimeDays: number } | null;
}

export interface RiskResponse {
  risks: RiskItem[];
  counts: { high: number; medium: number; low: number };
}

export interface Co2Factor {
  id: string;
  categoryId: string | null;
  categoryName: string;
  kgPerUnit: number;
}

export interface Co2PoRow {
  poId: string;
  supplier: string;
  expectedOn: string | null;
  kgCo2: number;
}

export interface Co2TrendRow {
  day: string;
  kgCo2: number;
}

export interface Co2Response {
  factors: Co2Factor[];
  byPo: Co2PoRow[];
  trend: Co2TrendRow[];
}

export interface UpsertCo2FactorBody {
  categoryId: string | null;
  kgPerUnit: number;
}

export interface UpsertCo2FactorResponse {
  id: string;
  categoryId: string | null;
  kgPerUnit: number;
}

export interface BriefResponse {
  brief: string;
  model: string;
  fallback: boolean;
  generatedAt: string;
}
