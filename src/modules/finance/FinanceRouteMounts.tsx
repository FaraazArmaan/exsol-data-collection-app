import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import FinancePage from './pages/FinancePage';
// L1 Owner (or legacy null-level) is all-on — consistent with the backend
// requireFinance bypass and every other gate in the codebase. We hand them the
// full finance.* set so internal page gates (add/edit/delete buttons) render.
import { ALL_FINANCE_PERMS } from './shared/permissions';

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_FINANCE_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const financeEnabled = enabledModules.some((m) => m.key === 'finance');
  return { user, client, perms, financeEnabled, slug: slug ?? '', loading };
}

// Enable-gate THEN permission — same order as the backend and Sidebar.
export function FinanceMount() {
  const { user, client, perms, financeEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!financeEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('finance.business.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <FinancePage slug={slug} perms={perms} />;
}
