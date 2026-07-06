// Permission helpers for the CRM module.
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

export const canViewCrm = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'crm.customers.view', levelNumber);

export const canCreateCrm = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'crm.customers.create', levelNumber);

export const canEditCrm = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'crm.customers.edit', levelNumber);

export const canDeleteCrm = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'crm.customers.delete', levelNumber);
