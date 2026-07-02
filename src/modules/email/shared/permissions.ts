// Permission helpers for the Email/Notifications module.
// L1 owners (level_number === 1 OR null) bypass the matrix — matching the
// server-side bypass in _email-authz.ts and every other module gate.
import type { UserPortalPermissionMatrix } from '../../user-portal/api';

export const isOwnerLevel = (levelNumber: number | null | undefined): boolean =>
  levelNumber == null || levelNumber === 1;

export const canViewOutbox = (
  perms: UserPortalPermissionMatrix, levelNumber: number | null | undefined,
): boolean => isOwnerLevel(levelNumber) || perms['email.customers.view'] === true;
