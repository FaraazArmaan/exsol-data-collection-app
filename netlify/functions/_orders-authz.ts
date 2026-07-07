// Orders authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';
import { ALL_ORDERS_PERMS } from '../../src/modules/orders/shared/permissions';

export { ALL_ORDERS_PERMS };

export type OrdersAuthCtx = ModuleAuthCtx;

export const requireOrders = makeModuleAuthz({
  moduleKeys: ['orders'],
  notEnabledCode: 'orders_module_not_enabled',
  allPerms: ALL_ORDERS_PERMS,
});

import type { AnySession } from './_shared/permissions';

// Returns a fully-populated BucketUserSession for logAudit callers (Tasks 3/5+).
export function ordersAuditSession(ctx: OrdersAuthCtx): AnySession {
  const session: AnySession = {
    kind: 'bucket_user',
    user_node_id: ctx.userNodeId,
    client_id: ctx.clientId,
    level_number: ctx.levelNumber,
  };
  return session;
}
