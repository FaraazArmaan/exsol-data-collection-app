import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import ManufacturingPage from './workspace/pages/ManufacturingPage';

const ALL_MANUFACTURING_PERMS = [
  'manufacturing.products.view', 'manufacturing.products.create',
  'manufacturing.products.edit', 'manufacturing.products.delete',
];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_MANUFACTURING_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const enabled = enabledModules.some((m) => m.key === 'manufacturing');
  return { user, client, perms, enabled, slug: slug ?? '', loading };
}

export const ManufacturingMount = (function () {
  return function Mount() {
    const { user, client, perms, enabled, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!enabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has('manufacturing.products.view')) return <Navigate to={`/c/${slug}`} replace />;
    return <ManufacturingPage slug={slug} perms={perms} />;
  };
})();
