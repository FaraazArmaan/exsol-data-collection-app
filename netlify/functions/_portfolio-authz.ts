// Portfolio authorization — thin wrapper over the shared module-authz factory.
// Gate order (401 session -> 412 enable-gate -> L1 Owner bypass -> 403 matrix)
// lives in _shared/module-authz.ts (iron rule 2, enforced structurally).
import { makeModuleAuthz, type ModuleAuthCtx } from './_shared/module-authz';

const ALL_PORTFOLIO_PERMS = [
  'portfolio.business.view',
  'portfolio.business.edit',
] as const;

export type PortfolioAuthCtx = ModuleAuthCtx;

export const requirePortfolio = makeModuleAuthz({
  moduleKeys: ['portfolio'],
  notEnabledCode: 'portfolio_module_not_enabled',
  allPerms: ALL_PORTFOLIO_PERMS,
});
