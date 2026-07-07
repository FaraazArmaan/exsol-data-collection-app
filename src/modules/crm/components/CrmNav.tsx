import { NavLink } from 'react-router-dom';

// Sub-navigation across the CRM views. One sidebar link (/crm) drives the module;
// these deep-linked routes switch between Customers / Dashboard / Leads / Social.
// Entries are added as each depth feature lands so there are never dead links.
interface Tab { to: string; label: string; end?: boolean; }
const TABS: Tab[] = [
  { to: '', label: 'Customers', end: true },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/leads', label: 'Leads' },
  { to: '/social', label: 'Social' },
];

export function CrmNav({ slug }: { slug: string }) {
  return (
    <nav className="crm-tabs" aria-label="CRM views">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          end={t.end}
          to={`/c/${slug}/crm${t.to}`}
          className={({ isActive }) => `crm-tab ${isActive ? 'crm-tab-active' : ''}`}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
