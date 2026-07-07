import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import SpendAnalyticsPage from './workspace/pages/SpendAnalyticsPage';

// Self-contained gated mount (default export) so the router can lazy-import it —
// this keeps recharts (pulled in by SpendAnalyticsPage) out of the main chunk.
// Mirrors the gate in ProcurementRouteMounts.
const ALL_PROCUREMENT_PERMS = [
  'procurement.products.view', 'procurement.products.create',
  'procurement.products.edit', 'procurement.products.delete',
];

export default function ProcurementSpendMount() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_PROCUREMENT_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const s = slug ?? '';
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${s}/login`} replace />;
  if (!enabledModules.some((m) => m.key === 'procurement')) return <Navigate to={`/c/${s}`} replace />;
  if (!perms.has('procurement.products.view')) return <Navigate to={`/c/${s}`} replace />;
  return <SpendAnalyticsPage slug={s} perms={perms} />;
}
