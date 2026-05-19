export type SystemRole = 'admin' | null;
export type WorkspaceRole = 'primary' | 'manager' | 'storekeeper';

export type ProductType = 'physical_goods' | 'food_item';
export type ProductStatus = 'draft' | 'active' | 'archived';
export type Marketplace =
  | 'amazon'
  | 'flipkart'
  | 'meta'
  | 'wa'
  | 'rakuten'
  | 'aliexpress'
  | 'swiggy'
  | 'zomato';

export type MovementReason =
  | 'purchase'
  | 'sale'
  | 'damage'
  | 'recount'
  | 'manual_adjust';
export type MovementSource = 'manual' | 'csv' | 'recount';

export type ExportProfile =
  | 'xlsx_comprehensive'
  | 'csv_comprehensive'
  | 'meta_catalog_csv';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export type ActorContext = {
  realActorId: string;
  realRole: SystemRole;
  onBehalfOfId: string | null;
  workspaceRole: WorkspaceRole | null;
  workspaceId: string | null;
  isImpersonating: boolean;
  impersonationReason: string | null;
};

export type Action =
  | 'product:read'
  | 'product:create'
  | 'product:update'
  | 'product:delete'
  | 'product:bulk_import'
  | 'stock:read'
  | 'stock:write'
  | 'export:create'
  | 'export:read'
  | 'backup:run'
  | 'backup:read'
  | 'backup:download'
  | 'file:read'
  | 'file:upload'
  | 'file:rename'
  | 'file:delete'
  | 'file:create_folder'
  | 'audit:read'
  | 'audit:read_admin_activity'
  | 'team:read'
  | 'team:invite'
  | 'team:remove'
  | 'team:change_role'
  | 'workspace:read_settings'
  | 'workspace:edit_settings'
  | 'workspace:rotate_key'
  | 'workspace:delete'
  | 'admin:onboard_client'
  | 'admin:disable_client'
  | 'admin:delete_client'
  | 'admin:unlock_workspace'
  | 'admin:impersonate'
  | 'admin:run_system_backup'
  | 'admin:view_all';

export type ResourceType =
  | 'product'
  | 'stock_movement'
  | 'file'
  | 'export_job'
  | 'backup'
  | 'audit_event'
  | 'team_member'
  | 'workspace'
  | 'system';

export type Resource = {
  type: ResourceType;
  id?: string;
  workspaceId?: string;
};
