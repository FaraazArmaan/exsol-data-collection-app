// Finance authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';
import { ALL_FINANCE_PERMS } from '../../src/modules/finance/shared/permissions';

export type FinanceAuthCtx = ModuleAuthCtx;

export const requireFinance = makeModuleAuthz({
  moduleKeys: ['finance'],
  notEnabledCode: 'finance_module_not_enabled',
  allPerms: ALL_FINANCE_PERMS,
});
