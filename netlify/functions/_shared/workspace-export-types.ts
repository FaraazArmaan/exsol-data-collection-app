// Type-only module — shapes the workspace export snapshot.
// Source of truth for the JSON wire format; mirrored 1:1 by CSV columns.

export interface ExportActor {
  kind: 'admin' | 'user_node';
  id: string;
  email: string;
}

export interface WorkspaceSnapshot {
  schema_version: 1;
  exported_at: string;
  exported_by: ExportActor;
  client: Record<string, unknown>;          // one public.clients row
  enabled_products: string[];               // product_key list
  levels: Record<string, unknown>[];        // client_levels
  roles: Record<string, unknown>[];         // client_roles
  cardinality_rules: Record<string, unknown>[];
  user_nodes: Record<string, unknown>[];
  credentials: Record<string, unknown>[];   // password_hash / temp_password_plain / password_reset_requested_at OMITTED
  files: {
    files: Record<string, unknown>[];
    categories: Record<string, unknown>[];
    allowed_nodes: Record<string, unknown>[];
    allowed_roles: Record<string, unknown>[];
    allowed_users: Record<string, unknown>[];
  };
  products: {
    products: Record<string, unknown>[];
    categories: Record<string, unknown>[];
    images: Record<string, unknown>[];
  };
}

export interface TableCounts {
  user_nodes: number;
  credentials: number;
  levels: number;
  roles: number;
  cardinality_rules: number;
  files: number;
  file_categories: number;
  file_allowed_nodes: number;
  file_allowed_roles: number;
  file_allowed_users: number;
  products: number;
  product_categories: number;
  product_images: number;
}

export function countTables(snap: WorkspaceSnapshot): TableCounts {
  return {
    user_nodes: snap.user_nodes.length,
    credentials: snap.credentials.length,
    levels: snap.levels.length,
    roles: snap.roles.length,
    cardinality_rules: snap.cardinality_rules.length,
    files: snap.files.files.length,
    file_categories: snap.files.categories.length,
    file_allowed_nodes: snap.files.allowed_nodes.length,
    file_allowed_roles: snap.files.allowed_roles.length,
    file_allowed_users: snap.files.allowed_users.length,
    products: snap.products.products.length,
    product_categories: snap.products.categories.length,
    product_images: snap.products.images.length,
  };
}
