import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import BrandSiteEditorPage from './BrandSiteEditorPage';

// Mirrors EmailRouteMounts / BookingRouteMounts: enable-gate + L1 Owner bypass
// in the same order as the backend requirePortfolio helper.
const ALL_PORTFOLIO_PERMS = ['portfolio.business.view', 'portfolio.business.edit'];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_PORTFOLIO_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const portfolioEnabled = enabledModules.some((m) => m.key === 'portfolio');
  return { user, client, perms, portfolioEnabled, slug: slug ?? '', loading };
}

function gate(perm: string, render: (slug: string, perms: ReadonlySet<string>) => JSX.Element) {
  return function Mount() {
    const { user, client, perms, portfolioEnabled, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!portfolioEnabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return render(slug, perms);
  };
}

export const BrandSiteMount = gate('portfolio.business.view', (slug, perms) => (
  <BrandSiteEditorPage slug={slug} perms={perms} />
));
