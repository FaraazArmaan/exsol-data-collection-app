// Frontend permission helpers for Inventory. Mirrors products/shared/permissions.ts:
// L1 Owner (level 1 or legacy null) is all-on; otherwise the explicit
// inventory.products.<verb> key must be present (missing ⇒ denied).
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

export const canViewInventory = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'inventory.products.view', lvl);
export const canEditInventory = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'inventory.products.edit', lvl);
