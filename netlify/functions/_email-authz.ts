// Email authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';

const ALL_EMAIL_PERMS = [
  'email.customers.view',
] as const;

export type EmailAuthCtx = ModuleAuthCtx;

export const requireEmail = makeModuleAuthz({
  moduleKeys: ['email'],
  notEnabledCode: 'email_module_not_enabled',
  allPerms: ALL_EMAIL_PERMS,
});
