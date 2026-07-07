import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import { CustomersListPage } from './vendor/CustomersListPage';
import { CustomerDetailPage } from './vendor/CustomerDetailPage';
import { CustomerDashboardPage } from './vendor/CustomerDashboardPage';
import { LeadsInboxPage } from './vendor/LeadsInboxPage';
import { SocialSyncPage } from './vendor/SocialSyncPage';

const ALL_CRM_PERMS = [
  'crm.customers.view', 'crm.customers.create', 'crm.customers.edit', 'crm.customers.delete',
];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  // L1 Owner (or legacy null-level) is all-on — consistent with the backend
  // requireCrm bypass and every other gate in the codebase (see Booking, POS).
  // We hand them the full crm.* set so internal page gates render too.
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_CRM_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const crmEnabled = enabledModules.some((m) => m.key === 'crm');
  return { user, client, perms, crmEnabled, slug: slug ?? '', loading };
}

function gate(perm: string, render: (slug: string, perms: ReadonlySet<string>) => JSX.Element) {
  return function Mount() {
    const { user, client, perms, crmEnabled, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!crmEnabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return render(slug, perms);
  };
}

export const CrmListMount = gate('crm.customers.view', (slug, perms) => <CustomersListPage slug={slug} perms={perms} />);
export const CrmDetailMount = gate('crm.customers.view', (slug, perms) => <CustomerDetailPage slug={slug} perms={perms} />);
export const CrmDashboardMount = gate('crm.customers.view', (slug, perms) => <CustomerDashboardPage slug={slug} perms={perms} />);
export const CrmLeadsMount = gate('crm.customers.view', (slug, perms) => <LeadsInboxPage slug={slug} perms={perms} />);
export const CrmSocialMount = gate('crm.customers.view', (slug, perms) => <SocialSyncPage slug={slug} perms={perms} />);
