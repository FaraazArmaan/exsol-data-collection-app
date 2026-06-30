import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicApi, PosApiError, type PublicMenuResponse } from '../api';
import { getOrCreateStorefrontSession } from '../lib/session';
import MenuPage from './MenuPage';
import { StorefrontShell, NotAvailableCard } from './StorefrontShell';

// Public menu page. Fetches the storefront menu once (publicApi), then reuses
// the v1 MenuPage for the tile grid + guest cart — passing loadMenu so MenuPage
// doesn't re-fetch (and doesn't hit the authed endpoint) and a checkoutHref
// into the public cart route. bucketId = slug (the guest cart keys by it; the
// submit endpoint re-resolves slug→client server-side). See spec §6.5.
export default function StorefrontMenuPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<PublicMenuResponse | null>(null);
  const [error, setError] = useState<PosApiError | null>(null);
  const sessionId = getOrCreateStorefrontSession();

  useEffect(() => {
    let cancel = false;
    publicApi.getMenu(slug!)
      .then((r) => { if (!cancel) setData(r); })
      .catch((e) => { if (!cancel) setError(e as PosApiError); });
    return () => { cancel = true; };
  }, [slug]);

  if (error) return <StorefrontShell><NotAvailableCard /></StorefrontShell>;
  if (!data) return <StorefrontShell>Loading…</StorefrontShell>;

  return (
    <StorefrontShell tenantName={data.tenant.name}>
      <MenuPage
        bucketId={slug!}
        userNodeId={`guest-${sessionId}`}
        slug={slug!}
        checkoutHref={`/menu/${slug}/cart`}
        loadMenu={() => Promise.resolve({ categories: data.categories, products: data.products })}
      />
    </StorefrontShell>
  );
}
