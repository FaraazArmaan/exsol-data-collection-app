// Frontend permission helpers for Warehouse. Mirrors inventory/shared/permissions.ts:
// L1 Owner (level 1 or legacy null) is all-on; otherwise the explicit
// warehouse.<bucket>.<verb> key must be present (missing ⇒ denied).
import type { UserPortalPermissionMatrix } from '../../user-portal/api';

export const isOwnerLevel = (levelNumber: number | null | undefined): boolean =>
  levelNumber == null || levelNumber === 1;

function has(
  perms: UserPortalPermissionMatrix,
  key: string,
  levelNumber: number | null | undefined,
): boolean {
  if (isOwnerLevel(levelNumber)) return true;
  return perms[key] === true;
}

export const canViewLocations = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'warehouse.business.view', lvl);
export const canCreateLocations = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'warehouse.business.create', lvl);
export const canEditLocations = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'warehouse.business.edit', lvl);
export const canDeleteLocations = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'warehouse.business.delete', lvl);
export const canViewStock = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'warehouse.products.view', lvl);
export const canTransferStock = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'warehouse.products.edit', lvl);
