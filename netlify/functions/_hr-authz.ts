// Hr authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';
import { ALL_HR_PERMS } from '../../src/modules/hr/shared/permissions';

export type HrAuthCtx = ModuleAuthCtx;

export const requireHr = makeModuleAuthz({
  moduleKeys: ['hr'],
  notEnabledCode: 'hr_module_not_enabled',
  allPerms: ALL_HR_PERMS,
});
