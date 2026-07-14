import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';

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
    <div className="brand-public-nav-wrap">
      <nav className="brand-public-nav" aria-label="Business services">
        {surfaces.shop ? (
          <NavLink
            to={`/storefront/${slug}/Order`}
            className={({ isActive }) => `brand-public-nav__link${isActive ? ' is-active' : ''}`}
          >
            Ordering
          </NavLink>
        ) : null}
        {surfaces.booking ? (
          <NavLink
            to={`/storefront/${slug}/Book`}
            className={({ isActive }) => `brand-public-nav__link${isActive ? ' is-active' : ''}`}
          >
            Booking
          </NavLink>
        ) : null}
      </nav>
    </div>
  );
}
