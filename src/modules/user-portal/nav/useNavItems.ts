import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { getModule } from '@registry/modules';
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

// Modules whose manifest sets `hasDedicatedNav` are kept out of the generic
// /m/:moduleKey rail to avoid a duplicate (or dead-stub) link: Sidebar.tsx
// renders their links from the manifest's `navLinks`, and surface-less modules
// (catalog = public /catalog/:slug; data-collection = onboarding wizard;
// project-service = folded into the Workforce link) render nowhere in the rail.
// The registry manifest is the single source of truth — there is no hand-synced
// module list here anymore.
const hasDedicatedNav = (moduleKey: string): boolean =>
  getModule(moduleKey)?.hasDedicatedNav === true;

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
  ).filter((m) => !hasDedicatedNav(m.key));

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
