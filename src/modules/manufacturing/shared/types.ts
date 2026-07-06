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
