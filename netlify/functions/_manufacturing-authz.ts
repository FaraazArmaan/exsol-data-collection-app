// Manufacturing authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';

export const ALL_MANUFACTURING_PERMS = [
  'manufacturing.products.view', 'manufacturing.products.create',
  'manufacturing.products.edit', 'manufacturing.products.delete',
  'manufacturing.business.view', 'manufacturing.business.create',
  'manufacturing.business.edit', 'manufacturing.business.delete',
] as const;

export type ManufacturingAuthCtx = ModuleAuthCtx;

export const requireManufacturing = makeModuleAuthz({
  moduleKeys: ['manufacturing'],
  notEnabledCode: 'manufacturing_module_not_enabled',
  allPerms: ALL_MANUFACTURING_PERMS,
});
