import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import type {
  UserPortalEnabledModule, UserPortalPermissionMatrix,
} from '../api';

export interface NavModuleItem {
  moduleKey: string;
  label: string;
  href: string;
}

interface ComputeArgs {
  slug: string;
  levelNumber: number | null;
  enabledModules: readonly UserPortalEnabledModule[];
  permissions: UserPortalPermissionMatrix;
}

// Modules with a dedicated sidebar entry — Sidebar.tsx renders these directly
// against their own route (not via /m/:moduleKey ModuleStub), so we keep them
// out of the generic Modules rail to avoid a duplicate link.
// Includes both modules that render a dedicated Sidebar link AND modules whose
// surface lives entirely outside the dashboard rail (catalog = public /catalog/:slug;
// data-collection = the Product Manager onboarding button + public /onboard/:token) —
// all must stay OUT of the generic /m/:key rail so no dead ModuleStub link appears.
const MODULES_WITH_DEDICATED_NAV = new Set<string>(['products', 'pos', 'booking', 'analytics', 'inventory', 'email', 'finance', 'procurement', 'warehouse', 'crm', 'manufacturing', 'workforce', 'project-service', 'portfolio', 'catalog', 'data-collection', 'supply-chain']);

// Pure — exported for unit tests.
export function computeNavItems(args: ComputeArgs): NavModuleItem[] {
  const { slug, levelNumber, enabledModules, permissions } = args;
  const isOwner = levelNumber == null || levelNumber === 1;

  // A Module appears in the rail iff the user has the 'view' verb on at least
  // one of its buckets. Keys look like '<moduleKey>.<bucket>.view'. We exclude
  // '_platform.*' surfaces — those are not Modules and never belong in this rail.
  const hasViewOnModule = (moduleKey: string): boolean => {
    const prefix = `${moduleKey}.`;
    for (const key of Object.keys(permissions)) {
      if (key.startsWith(prefix) && key.endsWith('.view')) return true;
    }
    return false;
  };

  const visible = (isOwner
    ? [...enabledModules]
    : enabledModules.filter((m) => hasViewOnModule(m.key))
  ).filter((m) => !MODULES_WITH_DEDICATED_NAV.has(m.key));

  visible.sort((a, b) => a.label.localeCompare(b.label));

  return visible.map((m) => ({
    moduleKey: m.key,
    label: m.label,
    href: `/c/${slug}/m/${m.key}`,
  }));
}

// React hook wrapper — reads auth context + URL.
export function useNavItems(): NavModuleItem[] {
  const { slug } = useParams<{ slug: string }>();
  const { user, enabledModules, permissions } = useUserAuth();

  return useMemo(() => {
    if (!slug || !user) return [];
    return computeNavItems({
      slug,
      levelNumber: user.level_number,
      enabledModules,
      permissions,
    });
  }, [slug, user, enabledModules, permissions]);
}
