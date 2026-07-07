import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicApi, PosApiError, type PublicMenuResponse } from '../shared/api';
import { getOrCreateStorefrontSession } from '../lib/session';
import MenuPage from './MenuPage';
import { NotAvailableCard } from './NotAvailableCard';

// Only render a CTA that points at an http(s) URL or a site-relative path —
// never javascript:/data:/protocol-relative (defence-in-depth vs the server
// validation, so stale/bypassed CMS data can't inject a scripted link).
function safeHref(h?: string): string | null {
  if (!h) return null;
  if (/^https?:\/\//i.test(h)) return h;
  return h.startsWith('/') && !h.startsWith('//') ? h : null;
}

// Public menu page. Fetches the storefront menu once (publicApi), then reuses
// the v1 MenuPage for the tile grid + guest cart — passing loadMenu so MenuPage
// doesn't re-fetch (and doesn't hit the authed endpoint) and a checkoutHref
// into the public cart route. bucketId = slug (the guest cart keys by it; the
// submit endpoint re-resolves slug→client server-side). See spec §6.5.
// Chrome (branded header) is supplied by StorefrontLayout; this page renders
// only its content into the layout Outlet. Availability rides on the menu
// fetch (404 → NotAvailableCard), never on the brand — see branding spec §9.4.
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

  if (error) return <NotAvailableCard />;
  if (!data) return <p className="storefront-loading">Loading…</p>;

  const hero = data.cms?.hero;
  const banners = data.cms?.banners ?? [];

  return (
    <>
      {hero?.enabled && hero.heading && (
        <section className="sf-hero">
          <h1 className="sf-hero__heading">{hero.heading}</h1>
          {hero.subheading && <p className="sf-hero__sub">{hero.subheading}</p>}
          {hero.ctaLabel && safeHref(hero.ctaHref) && (
            <a className="sf-hero__cta" href={safeHref(hero.ctaHref)!}>{hero.ctaLabel}</a>
          )}
        </section>
      )}
      {banners.length > 0 && (
        <div className="sf-banners">
          {banners.map((b, i) => <div key={i} className="sf-banner">{b.text}</div>)}
        </div>
      )}
      <MenuPage
        bucketId={slug!}
        userNodeId={`guest-${sessionId}`}
        slug={slug!}
        checkoutHref={`/menu/${slug}/cart`}
        loadMenu={() => Promise.resolve({ categories: data.categories, products: data.products })}
      />
    </>
  );
}
