import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import InventoryListPage from './workspace/pages/InventoryListPage';

const ALL_INVENTORY_PERMS = [
  'inventory.products.view', 'inventory.products.create',
  'inventory.products.edit', 'inventory.products.delete',
];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  // L1 Owner (or legacy null-level) is all-on — consistent with the backend
  // requireInventory bypass and every other gate in the codebase (Iron Rule 2).
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_INVENTORY_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const inventoryEnabled = enabledModules.some((m) => m.key === 'inventory');
  return { user, client, perms, inventoryEnabled, slug: slug ?? '', loading };
}

function gate(perm: string, render: (slug: string, perms: ReadonlySet<string>) => JSX.Element) {
  return function Mount() {
    const { user, client, perms, inventoryEnabled, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!inventoryEnabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return render(slug, perms);
  };
}

export const InventoryListMount = gate(
  'inventory.products.view',
  (slug, perms) => <InventoryListPage slug={slug} perms={perms} />,
);
