import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import WarehousePage from './workspace/pages/WarehousePage';

// L1 Owner (or legacy null-level) is all-on — consistent with the backend
// requireWarehouse bypass and every other gate in the codebase (Iron Rule 2).
// The full warehouse.* set is handed down so page-level button gates render.
const ALL_WAREHOUSE_PERMS = [
  'warehouse.business.view', 'warehouse.business.create',
  'warehouse.business.edit', 'warehouse.business.delete',
  'warehouse.products.view', 'warehouse.products.edit',
];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_WAREHOUSE_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const warehouseEnabled = enabledModules.some((m) => m.key === 'warehouse');
  return { user, client, perms, warehouseEnabled, slug: slug ?? '', loading };
}

// Enable-gate THEN permission — same order as the backend and Sidebar.
export function WarehouseMount() {
  const { user, client, perms, warehouseEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!warehouseEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('warehouse.business.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <WarehousePage slug={slug} perms={perms} />;
}
