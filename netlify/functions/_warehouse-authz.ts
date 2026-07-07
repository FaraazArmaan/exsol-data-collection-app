// Warehouse authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';

export const ALL_WAREHOUSE_PERMS = [
  'warehouse.business.view', 'warehouse.business.create',
  'warehouse.business.edit', 'warehouse.business.delete',
  'warehouse.products.view', 'warehouse.products.create',
  'warehouse.products.edit', 'warehouse.products.delete',
] as const;

export type WarehouseAuthCtx = ModuleAuthCtx;

export const requireWarehouse = makeModuleAuthz({
  moduleKeys: ['warehouse'],
  notEnabledCode: 'warehouse_module_not_enabled',
  allPerms: ALL_WAREHOUSE_PERMS,
});
