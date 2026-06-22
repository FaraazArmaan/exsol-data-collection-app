import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import MenuPage from './pages/MenuPage';
import CartPage from './pages/CartPage';
import SalesListPage from './pages/SalesListPage';

function useAuthBits() {
  const { user, client, permissions, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const perms = useMemo(
    () => new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k)),
    [permissions],
  );
  return { user, client, perms, slug: slug ?? '', loading };
}

export function PosMenuMount() {
  const { user, client, perms, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!perms.has('pos.menu.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <MenuPage bucketId={client.id} userNodeId={user.id} slug={slug} />;
}

export function PosCartMount() {
  const { user, client, perms, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!perms.has('pos.menu.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <CartPage bucketId={client.id} userNodeId={user.id} slug={slug} />;
}

export function PosSalesMount() {
  const { user, perms, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!perms.has('pos.history.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <SalesListPage perms={perms} slug={slug} />;
}
