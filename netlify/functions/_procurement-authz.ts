// Procurement authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';

export const ALL_PROCUREMENT_PERMS = [
  'procurement.products.view', 'procurement.products.create',
  'procurement.products.edit', 'procurement.products.delete',
] as const;

export type ProcurementAuthCtx = ModuleAuthCtx;

export const requireProcurement = makeModuleAuthz({
  moduleKeys: ['procurement'],
  notEnabledCode: 'procurement_module_not_enabled',
  allPerms: ALL_PROCUREMENT_PERMS,
});
