// Orders permission keys — single source for the FE route gate
// (OrdersRouteMounts.tsx) and the BE authz (_orders-authz.ts).
//
// L1 Owners are handed the full set by both consumers (enable-gate first,
// then Owner bypass — the codebase's iron rule #2).
import type { UserPortalPermissionMatrix } from '../../user-portal/api';

export const ALL_ORDERS_PERMS = [
  'orders.business.view', 'orders.business.create',
  'orders.business.edit', 'orders.business.delete',
] as const;

export type OrdersPermission = (typeof ALL_ORDERS_PERMS)[number];

const isOwnerLevel = (levelNumber: number | null | undefined): boolean =>
  levelNumber == null || levelNumber === 1;

function has(
  perms: UserPortalPermissionMatrix,
  key: string,
  levelNumber: number | null | undefined,
): boolean {
  if (isOwnerLevel(levelNumber)) return true;
  return perms[key] === true;
}

export const canViewOrders = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'orders.business.view', lvl);
export const canEditOrders = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'orders.business.edit', lvl);
export const canCreateOrders = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'orders.business.create', lvl);
