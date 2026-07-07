// Permission helpers for the Marketing module.
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

export const canViewMarketing = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'marketing.customers.view', levelNumber);

export const canCreateMarketing = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'marketing.customers.create', levelNumber);

export const canEditMarketing = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'marketing.customers.edit', levelNumber);

export const canDeleteMarketing = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'marketing.customers.delete', levelNumber);

// ROI/analytics is a read projection over campaign data → gated on the same
// customers.view key (DATA_BUCKETS is closed; no dedicated analytics bucket).
export const canViewMarketingAnalytics = (perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined) =>
  has(perms, 'marketing.customers.view', levelNumber);
