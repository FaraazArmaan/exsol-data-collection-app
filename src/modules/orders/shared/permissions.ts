// Orders permission keys — single source for the FE route gate
// (OrdersRouteMounts.tsx) and the BE authz (_orders-authz.ts).
//
// L1 Owners are handed the full set by both consumers (enable-gate first,
// then Owner bypass — the codebase's iron rule #2).

export const ALL_ORDERS_PERMS = [
  'orders.business.view', 'orders.business.create',
  'orders.business.edit', 'orders.business.delete',
] as const;
