import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  slug: string;
}

export function PublicSurfaceNav({ slug }: Props) {
  const [surfaces, setSurfaces] = useState({ shop: false, booking: false });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/site-surfaces/${encodeURIComponent(slug)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((value) => {
        if (!cancelled && value) setSurfaces({ shop: !!value.shop, booking: !!value.booking });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!surfaces.shop && !surfaces.booking) return null;
  return (
    <nav className="brand-public-nav" aria-label="Business services">
      {surfaces.shop ? <Link to={`/storefront/${slug}`}>Shop</Link> : null}
      {surfaces.booking ? <Link to={`/book/${slug}`}>Book</Link> : null}
    </nav>
  );
}
