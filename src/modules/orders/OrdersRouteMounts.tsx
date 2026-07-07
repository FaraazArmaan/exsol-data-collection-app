import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import OrdersDashboardPage from './workspace/pages/OrdersDashboardPage';
import { ALL_ORDERS_PERMS } from './shared/permissions';

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  // L1 Owner (or legacy null-level) is all-on — consistent with the backend
  // requireOrders bypass and every other gate in the codebase (Iron Rule 2).
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_ORDERS_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const ordersEnabled = enabledModules.some((m) => m.key === 'orders');
  return { user, client, perms, ordersEnabled, slug: slug ?? '', loading };
}

// Enable-gate THEN permission — same order as the backend and Sidebar.
export function OrdersDashboardMount() {
  const { user, client, perms, ordersEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!ordersEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('orders.business.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <OrdersDashboardPage slug={slug} perms={perms} />;
}
