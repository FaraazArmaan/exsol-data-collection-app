// Crm authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';

const ALL_CRM_PERMS = [
  'crm.customers.view', 'crm.customers.create', 'crm.customers.edit', 'crm.customers.delete',
] as const;

export type CrmAuthCtx = ModuleAuthCtx;

export const requireCrm = makeModuleAuthz({
  moduleKeys: ['crm'],
  notEnabledCode: 'crm_module_not_enabled',
  allPerms: ALL_CRM_PERMS,
});
