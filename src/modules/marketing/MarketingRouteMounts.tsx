import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import { CampaignsListPage } from './vendor/CampaignsListPage';
import { CampaignComposePage } from './vendor/CampaignComposePage';
import { CampaignDetailPage } from './vendor/CampaignDetailPage';

const ALL_MARKETING_PERMS = [
  'marketing.customers.view', 'marketing.customers.create', 'marketing.customers.edit', 'marketing.customers.delete',
];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_MARKETING_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const marketingEnabled = enabledModules.some((m) => m.key === 'marketing');
  return { user, client, perms, marketingEnabled, slug: slug ?? '', loading };
}

function gate(perm: string, render: (slug: string, perms: ReadonlySet<string>) => JSX.Element) {
  return function Mount() {
    const { user, client, perms, marketingEnabled, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!marketingEnabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return render(slug, perms);
  };
}

export const MarketingListMount = gate('marketing.customers.view', (slug, perms) => <CampaignsListPage slug={slug} perms={perms} />);
export const MarketingComposeMount = gate('marketing.customers.create', (slug, perms) => <CampaignComposePage slug={slug} perms={perms} />);
export const MarketingDetailMount = gate('marketing.customers.view', (slug, perms) => <CampaignDetailPage slug={slug} perms={perms} />);
