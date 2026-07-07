import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import { POS_ACTIONS } from '../registry/types';
import MenuPage from './pages/MenuPage';
import CartPage from './pages/CartPage';
import SalesListPage from './pages/SalesListPage';
import CouponsPage from './pages/CouponsPage';
import ReviewsPage from './pages/ReviewsPage';
import BundlesPage from './pages/BundlesPage';
import TaxPage from './pages/TaxPage';
import StorefrontCmsPage from './pages/StorefrontCmsPage';
import MarketplacePage from './pages/MarketplacePage';

const ALL_POS_PERMS = POS_ACTIONS.map((a) => `pos.${a}`);

interface AuthedBits {
  userId: string;
  clientId: string;
  slug: string;
  perms: ReadonlySet<string>;
}

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

// Enable-gate THEN permission — same order as the backend and Sidebar
// (Iron Rule 2). Mirrors the local gate() factory used by booking/inventory/crm.
// The per-page permission mirrors the server gate (comments preserved inline
// at each mount below).
function gate(perm: string, render: (bits: AuthedBits) => JSX.Element) {
  return function Mount() {
    const { user, client, perms, posEnabled, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!posEnabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return render({ userId: user.id, clientId: client.id, slug, perms });
  };
}

export const PosMenuMount = gate('pos.menu.view', (b) => <MenuPage bucketId={b.clientId} userNodeId={b.userId} slug={b.slug} />);
export const PosCartMount = gate('pos.menu.view', (b) => <CartPage bucketId={b.clientId} userNodeId={b.userId} slug={b.slug} />);
// Coupon generation rides pos.sale.refund (L1 all-on) — mirrors the server gate.
export const PosCouponsMount = gate('pos.sale.refund', () => <CouponsPage />);
// Review moderation rides pos.history.viewAll (L1 all-on) — mirrors the server gate.
export const PosReviewsMount = gate('pos.history.viewAll', () => <ReviewsPage />);
// Bundle management rides pos.sale.refund (L1 all-on) — mirrors the server gate.
export const PosBundlesMount = gate('pos.sale.refund', () => <BundlesPage />);
// Tax settings ride pos.sale.refund (L1 all-on) — mirrors the server gate.
export const PosTaxMount = gate('pos.sale.refund', () => <TaxPage />);
// Storefront CMS rides pos.sale.refund (L1 all-on) — mirrors the server gate.
export const PosStorefrontCmsMount = gate('pos.sale.refund', () => <StorefrontCmsPage />);
// Marketplace feeds ride pos.sale.refund (L1 all-on) — mirrors the server gate.
export const PosMarketplaceMount = gate('pos.sale.refund', () => <MarketplacePage />);

// Kept explicit: historically this mount only requires `user` (no client
// check) before rendering — preserved as-is rather than folded into gate().
export function PosSalesMount() {
  const { user, perms, posEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!posEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('pos.history.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <SalesListPage perms={perms} slug={slug} />;
}
