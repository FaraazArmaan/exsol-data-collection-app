import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import { POS_ACTIONS } from '../registry/types';
import MenuPage from './pages/MenuPage';
import CartPage from './pages/CartPage';
import SalesListPage from './pages/SalesListPage';

const ALL_POS_PERMS = POS_ACTIONS.map((a) => `pos.${a}`);

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  // L1 Owner (or a legacy null-level node) is all-on — consistent with the
  // backend requirePos bypass and every other gate. We hand them the full
  // pos.* set so SalesListPage's FSM action buttons render too.
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_POS_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const posEnabled = enabledModules.some((m) => m.key === 'pos');
  return { user, client, perms, posEnabled, slug: slug ?? '', loading };
}

export function PosMenuMount() {
  const { user, client, perms, posEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!posEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('pos.menu.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <MenuPage bucketId={client.id} userNodeId={user.id} slug={slug} />;
}

export function PosCartMount() {
  const { user, client, perms, posEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!posEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('pos.menu.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <CartPage bucketId={client.id} userNodeId={user.id} slug={slug} />;
}

export function PosSalesMount() {
  const { user, perms, posEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!posEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('pos.history.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <SalesListPage perms={perms} slug={slug} />;
}
