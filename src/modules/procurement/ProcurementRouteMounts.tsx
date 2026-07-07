import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import PurchaseOrdersPage from './workspace/pages/PurchaseOrdersPage';
import SuppliersPage from './workspace/pages/SuppliersPage';
import PurchaseOrderDetailPage from './workspace/pages/PurchaseOrderDetailPage';
import ThreeWayMatchPage from './workspace/pages/ThreeWayMatchPage';

const ALL_PROCUREMENT_PERMS = [
  'procurement.products.view', 'procurement.products.create',
  'procurement.products.edit', 'procurement.products.delete',
];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  // L1 Owner (or legacy null-level) is all-on — consistent with the backend
  // requireProcurement bypass and every other gate in the codebase (Iron Rule 2).
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_PROCUREMENT_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const procurementEnabled = enabledModules.some((m) => m.key === 'procurement');
  return { user, client, perms, procurementEnabled, slug: slug ?? '', loading };
}

function gate(perm: string, render: (slug: string, perms: ReadonlySet<string>) => JSX.Element) {
  return function Mount() {
    const { user, client, perms, procurementEnabled, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!procurementEnabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return render(slug, perms);
  };
}

export const ProcurementOrdersMount = gate(
  'procurement.products.view',
  (slug, perms) => <PurchaseOrdersPage slug={slug} perms={perms} />,
);
export const ProcurementSuppliersMount = gate(
  'procurement.products.view',
  (slug, perms) => <SuppliersPage slug={slug} perms={perms} />,
);
export const ProcurementOrderDetailMount = gate(
  'procurement.products.view',
  (slug, perms) => <PurchaseOrderDetailPage slug={slug} perms={perms} />,
);
export const ProcurementMatchMount = gate(
  'procurement.products.view',
  (slug, perms) => <ThreeWayMatchPage slug={slug} perms={perms} />,
);
