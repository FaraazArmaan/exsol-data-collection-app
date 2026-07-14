import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';

interface Surfaces {
  shop: boolean;
  booking: boolean;
}

// The bare storefront URL is only an entry point. It resolves to the first
// published surface, so a booking-only business never renders the ordering UI.
export default function StorefrontHome() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [surfaces, setSurfaces] = useState<Surfaces | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/site-surfaces/${encodeURIComponent(slug)}`)
      .then((response) => (response.ok ? response.json() : { shop: false, booking: false }))
      .then((value: Surfaces) => {
        if (!cancelled) setSurfaces({ shop: !!value.shop, booking: !!value.booking });
      })
      .catch(() => {
        if (!cancelled) setSurfaces({ shop: false, booking: false });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!surfaces) return <p className="storefront-loading">Loading storefront…</p>;
  if (surfaces.booking) return <Navigate to={`/storefront/${slug}/Book`} replace />;
  if (surfaces.shop) return <Navigate to={`/storefront/${slug}/Order`} replace />;
  return <Navigate to={`/storefront/${slug}/Order`} replace />;
}
