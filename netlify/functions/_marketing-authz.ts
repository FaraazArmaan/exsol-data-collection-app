// Marketing authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';

const ALL_MARKETING_PERMS = [
  'marketing.customers.view', 'marketing.customers.create',
  'marketing.customers.edit', 'marketing.customers.delete',
] as const;

export type MarketingAuthCtx = ModuleAuthCtx;

export const requireMarketing = makeModuleAuthz({
  moduleKeys: ['marketing'],
  notEnabledCode: 'marketing_module_not_enabled',
  allPerms: ALL_MARKETING_PERMS,
});
