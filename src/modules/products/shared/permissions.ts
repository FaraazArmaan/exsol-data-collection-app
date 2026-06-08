// Permission helpers for the workspace Product Manager.
//
// The user-portal auth context exposes `permissions` as a flat
// `Record<'<module>.<bucket>.<verb>', true>` map. Missing keys ⇒ denied.
//
// L1 owners (level_number === 1 OR null) bypass the matrix and have implicit
// access to every flag — matching the server-side bypass in
// `_shared/permissions.ts` and the dynamic-module rail rule in
// `user-portal/nav/useNavItems.ts`.

import type { UserPortalPermissionMatrix } from '../../user-portal/api';

export const isOwnerLevel = (levelNumber: number | null | undefined): boolean =>
  levelNumber == null || levelNumber === 1;

function has(perms: UserPortalPermissionMatrix, key: string, levelNumber: number | null | undefined): boolean {
  if (isOwnerLevel(levelNumber)) return true;
  return perms[key] === true;
}

export const canViewProducts = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'products.products.view', levelNumber);

export const canCreateProducts = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'products.products.create', levelNumber);

export const canEditProducts = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'products.products.edit', levelNumber);

export const canDeleteProducts = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'products.products.delete', levelNumber);

// Category management uses the per-verb product flags. The Categories page
// itself is gated by create — adding categories is the canonical entry point.
// (Renaming requires edit; deleting requires delete — enforced server-side.)
export const canManageCategories = canCreateProducts;
