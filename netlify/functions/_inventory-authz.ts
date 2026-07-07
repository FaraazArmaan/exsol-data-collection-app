// Inventory authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';

export const ALL_INVENTORY_PERMS = [
  'inventory.products.view', 'inventory.products.create',
  'inventory.products.edit', 'inventory.products.delete',
] as const;

export type InventoryAuthCtx = ModuleAuthCtx;

export const requireInventory = makeModuleAuthz({
  moduleKeys: ['inventory'],
  notEnabledCode: 'inventory_module_not_enabled',
  allPerms: ALL_INVENTORY_PERMS,
});
