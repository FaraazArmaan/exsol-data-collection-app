// Permission helpers for the Brand Portfolio Site module.
// L1 owners (level_number === 1 OR null) bypass the matrix — matching the
// server-side bypass in _portfolio-authz.ts.
import type { UserPortalPermissionMatrix } from '../../user-portal/api';

export const isOwnerLevel = (levelNumber: number | null | undefined): boolean =>
  levelNumber == null || levelNumber === 1;

export const canEditSite = (p: UserPortalPermissionMatrix, l: number | null | undefined): boolean =>
  isOwnerLevel(l) || p['portfolio.business.edit'] === true;
