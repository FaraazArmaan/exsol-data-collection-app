import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BrandShell, useBrand } from '../../branding';
import { mergeSections } from '../shared/sections';
import type { SiteSections } from '../shared/types';

interface SiteState { published: boolean; sections?: unknown }
interface MenuProduct { id: string; name: string; salePriceCents: number | null }

// Public, unauthenticated portfolio page. Composes three public endpoints:
// brand (useBrand → /api/public/brand), site config (/api/public/site), and
// the storefront catalogue (/api/public/menu, best-effort). Renders inside
// <BrandShell> so it inherits the mig-050 palette / theme / fonts.
export default function BrandPortfolioPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { brand, loading: brandLoading } = useBrand(slug);
  const [site, setSite] = useState<SiteState | null>(null);
  const [siteErr, setSiteErr] = useState<string | null>(null);
  const [products, setProducts] = useState<MenuProduct[]>([]);

  useEffect(() => {
    let alive = true;
    setSite(null);
    setSiteErr(null);
    fetch(`/api/public/site/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setSite(d as SiteState); })
      .catch(() => { if (alive) setSiteErr('load_failed'); });
    return () => { alive = false; };
  }, [slug]);

  // Products are best-effort — the storefront may not be enabled; ignore failures.
  useEffect(() => {
    let alive = true;
    fetch(`/api/public/menu/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setProducts((d?.products as MenuProduct[]) ?? []); })
      .catch(() => { if (alive) setProducts([]); });
    return () => { alive = false; };
  }, [slug]);

  const name = brand?.name ?? 'Our workspace';
  const heroUrls = brand?.heroUrls ?? [];
  const sections: SiteSections | null = site?.published ? mergeSections(site.sections) : null;

  if (brandLoading || site === null) {
    return (
      <BrandShell brand={brand ?? undefined} fallbackName="Portfolio">
        <div className="bp-public-state">Loading…</div>
      </BrandShell>
    );
  }

  if (siteErr || !site.published || !sections) {
    return (
      <BrandShell brand={brand ?? undefined} fallbackName="Portfolio">
        <div className="bp-public-state">
          <h2>{siteErr ? 'Something went wrong' : 'This site isn’t available yet'}</h2>
          <p>{siteErr ? 'Please try again in a moment.' : 'The owner hasn’t published their page yet.'}</p>
        </div>
      </BrandShell>
    );
  }

  return (
    <BrandShell brand={brand ?? undefined} fallbackName={name}>
      <div className="bp-public">
        {sections.hero.enabled && (
          <section className="bp-hero">
            <h1 className="bp-hero-title">{name}</h1>
            {sections.hero.tagline && <p className="bp-hero-tagline">{sections.hero.tagline}</p>}
            {sections.booking.enabled && (
              <a className="bp-cta" href={`/c/${slug}/book`}>Book an appointment</a>
            )}
          </section>
        )}

        {sections.products.enabled && (
          <section className="bp-section">
            <h2 className="bp-section-title">What we offer</h2>
            {products.length === 0 ? (
              <p className="bp-empty">Our catalogue is coming soon.</p>
            ) : (
              <div className="bp-grid">
                {products.slice(0, 12).map((p) => (
                  <div key={p.id} className="bp-product">
                    <div className="bp-product-name">{p.name}</div>
                    {typeof p.salePriceCents === 'number' && (
                      <div className="bp-product-price">₹{(p.salePriceCents / 100).toFixed(2)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {sections.gallery.enabled && (
          <section className="bp-section">
            <h2 className="bp-section-title">Gallery</h2>
            {heroUrls.length === 0 ? (
              <p className="bp-empty">No gallery images yet.</p>
            ) : (
              <div className="bp-gallery">
                {heroUrls.map((u, i) => (
                  <img key={i} src={u} alt={`${name} ${i + 1}`} className="bp-gallery-img" loading="lazy" />
                ))}
              </div>
            )}
          </section>
        )}

        {sections.booking.enabled && (
          <section className="bp-section bp-booking">
            <h2 className="bp-section-title">Ready to visit?</h2>
            <a className="bp-cta" href={`/c/${slug}/book`}>Book an appointment</a>
          </section>
        )}

        {sections.contact.enabled && (
          <section className="bp-section bp-contact">
            <h2 className="bp-section-title">Get in touch</h2>
            <div className="bp-contact-lines">
              <div><strong>{name}</strong></div>
              {sections.contact.email && (
                <div>✉ <a href={`mailto:${sections.contact.email}`}>{sections.contact.email}</a></div>
              )}
              {sections.contact.phone && <div>☎ {sections.contact.phone}</div>}
              {sections.contact.address && <div>📍 {sections.contact.address}</div>}
            </div>
          </section>
        )}

        <footer className="bp-footer">Powered by {name}</footer>
      </div>
    </BrandShell>
  );
}
