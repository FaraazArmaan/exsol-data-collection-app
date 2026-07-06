// Finance permission keys — single source for the FE route gate
// (FinanceRouteMounts.tsx) and the BE authz (_finance-authz.ts), which
// previously each carried their own copy of this list.
//
// L1 Owners are handed the full set by both consumers (enable-gate first,
// then Owner bypass — the codebase's iron rule #2).
export const ALL_FINANCE_PERMS = [
  'finance.business.view', 'finance.business.create',
  'finance.business.edit', 'finance.business.delete',
] as const;

export type FinancePermission = (typeof ALL_FINANCE_PERMS)[number];
