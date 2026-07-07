import { NavLink, useParams } from 'react-router-dom';

interface TabDef {
  to: string;
  label: string;
  end?: boolean;
}

// In-page sub-nav for the inventory module. Grows as depth features land — kept
// in one place so every inventory page shares the same tab bar.
const TABS: TabDef[] = [
  { to: 'dashboard', label: 'Dashboard' },
  { to: '', label: 'Stock', end: true },
  { to: 'returns', label: 'Returns' },
  { to: 'locations', label: 'Locations' },
  { to: 'labels', label: 'Labels' },
];

export function InventoryTabs() {
  const { slug } = useParams<{ slug: string }>();
  const base = `/c/${slug}/inventory`;
  return (
    <nav className="inv-tabs" aria-label="Inventory sections">
      {TABS.map((t) => (
        <NavLink
          key={t.label}
          end={t.end ?? false}
          to={t.to ? `${base}/${t.to}` : base}
          className={({ isActive }) => (isActive ? 'inv-tab inv-tab-active' : 'inv-tab')}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
