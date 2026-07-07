// Workforce authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
// Covers BOTH workforce and project-service (the workforce product carries both).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';

export const ALL_WORKFORCE_PERMS = [
  'workforce.employees.view', 'workforce.employees.create',
  'workforce.employees.edit', 'workforce.employees.delete',
  'workforce.leave.view', 'workforce.leave.create',
  'workforce.leave.edit', 'workforce.leave.delete',
  'workforce.payroll.view', 'workforce.payroll.create',
  'workforce.payroll.edit', 'workforce.payroll.delete',
  'workforce.assets.view', 'workforce.assets.create',
  'workforce.assets.edit', 'workforce.assets.delete',
  'project-service.business.view', 'project-service.business.create',
  'project-service.business.edit', 'project-service.business.delete',
  'project-service.customers.view',
] as const;

export type WorkforceAuthCtx = ModuleAuthCtx;

export const requireWorkforce = makeModuleAuthz({
  moduleKeys: ['workforce', 'project-service'],
  notEnabledCode: 'workforce_module_not_enabled',
  allPerms: ALL_WORKFORCE_PERMS,
});
