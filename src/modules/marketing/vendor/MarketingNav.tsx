import { Link } from 'react-router-dom';

// One tab bar for the Marketing module. Previously each depth surface (Campaign
// ROI, Webhooks, GDPR, Social) was its own top-level sidebar link + a "Campaigns"
// back-button on each page; that cluttered the sidebar with 5 marketing entries.
// Now the module has a single "Marketing" sidebar link and these render as tabs.
const TABS = [
  { key: 'campaigns', label: 'Campaigns', path: '' },
  { key: 'roi', label: 'Campaign ROI', path: '/roi' },
  { key: 'webhooks', label: 'Webhooks', path: '/webhooks' },
  { key: 'gdpr', label: 'GDPR', path: '/gdpr' },
  { key: 'social', label: 'Social', path: '/social' },
] as const;

export type MarketingTab = (typeof TABS)[number]['key'];

export function MarketingNav({ slug, active }: { slug: string; active: MarketingTab }) {
  return (
    <nav className="mkt-tabs">
      {TABS.map((t) =>
        t.key === active ? (
          <span key={t.key} className="mkt-tab-link mkt-tab-active">{t.label}</span>
        ) : (
          <Link key={t.key} className="mkt-tab-link" to={`/c/${slug}/marketing${t.path}`}>
            {t.label}
          </Link>
        ),
      )}
    </nav>
  );
}
