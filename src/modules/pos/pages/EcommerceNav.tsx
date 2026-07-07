import { Link, useParams } from 'react-router-dom';

// One tab bar for the ecommerce surfaces (ERP module 12). These ride the POS
// staff app on frozen pos.* keys, but instead of six separate sidebar links they
// live under a single "Ecommerce" sidebar entry (registry navLink) with these tabs.
const TABS = [
  { key: 'coupons', label: 'Coupons' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'bundles', label: 'Bundles' },
  { key: 'tax', label: 'Tax' },
  { key: 'storefront', label: 'Storefront' },
  { key: 'marketplace', label: 'Marketplace' },
] as const;

export type EcommerceTab = (typeof TABS)[number]['key'];

export function EcommerceNav({ active }: { active: EcommerceTab }) {
  const { slug } = useParams();
  return (
    <nav className="pos-ecom-tabs">
      {TABS.map((t) =>
        t.key === active ? (
          <span key={t.key} className="pos-ecom-tab pos-ecom-tab-active">{t.label}</span>
        ) : (
          <Link key={t.key} className="pos-ecom-tab" to={`/c/${slug}/pos/${t.key}`}>
            {t.label}
          </Link>
        ),
      )}
    </nav>
  );
}
