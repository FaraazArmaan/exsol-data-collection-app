// Frontend permission helpers for Procurement. Mirrors inventory/products:
// L1 Owner (level 1 or legacy null) is all-on; otherwise the explicit
// procurement.products.<verb> key must be present (missing ⇒ denied).
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

export const canViewProcurement = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'procurement.products.view', lvl);
export const canCreateProcurement = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'procurement.products.create', lvl);
export const canEditProcurement = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'procurement.products.edit', lvl);
export const canDeleteProcurement = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'procurement.products.delete', lvl);
