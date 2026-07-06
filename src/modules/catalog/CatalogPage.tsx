import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import MenuPage from '../pos/pages/MenuPage';
import type { MenuResponse } from '../pos/api';
import { NotAvailableCard } from '../pos/pages/NotAvailableCard';

// Public catalog page. Fetches the catalog once, then reuses the exact storefront
// MenuPage grid in `catalogMode` (no cart — see MenuPage's one added prop). The
// only bespoke chrome is a contact CTA (mailto/tel) built from client settings.
// Brand header is supplied by the shared StorefrontLayout wrapping this route.

interface CatalogData extends MenuResponse {
  tenant: { name: string; contactPhone: string | null; contactEmail: string | null };
}

export default function CatalogPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<CatalogData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/public/catalog/${encodeURIComponent(slug ?? '')}`, { credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error('unavailable'); return r.json(); })
      .then((d) => { if (!cancel) setData(d as CatalogData); })
      .catch(() => { if (!cancel) setError(true); });
    return () => { cancel = true; };
  }, [slug]);

  if (error) return <NotAvailableCard />;
  if (!data) return <p className="storefront-loading">Loading…</p>;

  const { tenant } = data;
  const hasContact = !!(tenant.contactPhone || tenant.contactEmail);

  return (
    <div className="cat-page">
      {data.products.length === 0 ? (
        <p className="cat-empty">This catalog has no products yet.</p>
      ) : (
        <MenuPage
          bucketId={slug ?? ''}
          userNodeId={`guest-catalog-${slug ?? ''}`}
          slug={slug ?? ''}
          catalogMode
          loadMenu={() => Promise.resolve({ categories: data.categories, products: data.products })}
        />
      )}

      {hasContact && (
        <div className="cat-cta" role="complementary" aria-label="Contact">
          <span className="cat-cta__label">Interested? Get in touch</span>
          <div className="cat-cta__actions">
            {tenant.contactPhone && (
              <a className="cat-cta__btn" href={`tel:${tenant.contactPhone}`}>Call {tenant.contactPhone}</a>
            )}
            {tenant.contactEmail && (
              <a className="cat-cta__btn cat-cta__btn--ghost" href={`mailto:${tenant.contactEmail}`}>Email us</a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
