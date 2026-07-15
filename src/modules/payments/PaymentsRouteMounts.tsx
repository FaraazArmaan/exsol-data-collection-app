import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import { ALL_PAYMENTS_PERMS } from './shared/permissions';
import PaymentsDashboardPage from './workspace/PaymentsDashboardPage';
import './payments.css';

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_PAYMENTS_PERMS)
      : new Set(Object.entries(permissions).filter(([, allowed]) => allowed).map(([key]) => key))),
    [isOwner, permissions],
  );
  const paymentsEnabled = enabledModules.some((module) => module.key === 'payments');
  return { user, client, perms, paymentsEnabled, slug: slug ?? '', loading };
}

export function PaymentsMount() {
  const { user, client, perms, paymentsEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!paymentsEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('payments.customers.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <PaymentsDashboardPage canManageProvider={perms.has('payments.products.edit')} />;
}
