import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';
import { ALL_PAYMENTS_PERMS } from '../../src/modules/payments/shared/permissions';

export type PaymentsAuthCtx = ModuleAuthCtx;

export const requirePayments = makeModuleAuthz({
  moduleKeys: ['payments'],
  notEnabledCode: 'payments_module_not_enabled',
  allPerms: ALL_PAYMENTS_PERMS,
});
