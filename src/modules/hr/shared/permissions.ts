// HR permission keys — single source for the FE route gate (HrRouteMounts.tsx)
// and the BE authz (_hr-authz.ts). L1 Owners are handed the full set by both
// consumers (enable-gate first, then Owner bypass — iron rule #2).
export const ALL_HR_PERMS = [
  'hr.employees.view',
  'hr.employees.create',
  'hr.employees.edit',
  'hr.employees.delete',
] as const;
