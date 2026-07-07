import type { UserPortalPermissionMatrix } from '../../user-portal/api';

export const isOwnerLevel = (levelNumber: number | null | undefined): boolean =>
  levelNumber == null || levelNumber === 1;

function has(perms: UserPortalPermissionMatrix, key: string, lvl: number | null | undefined): boolean {
  if (isOwnerLevel(lvl)) return true;
  return perms[key] === true;
}

export const canViewManufacturing = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'manufacturing.products.view', lvl);
export const canEditManufacturing = (p: UserPortalPermissionMatrix, lvl: number | null | undefined) =>
  has(p, 'manufacturing.products.edit', lvl);
