import { NavLink, useParams } from 'react-router-dom';

// Sub-nav between the two procurement surfaces. Kept simple; the active state
// is driven by NavLink's isActive (with `end` on the orders tab so it doesn't
// stay active on /suppliers).
export function ProcurementTabs() {
  const { slug } = useParams<{ slug: string }>();
  const cls = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'proc-tab proc-tab-active' : 'proc-tab';
  return (
    <nav className="proc-tabs" aria-label="Procurement sections">
      <NavLink to={`/c/${slug}/procurement`} end className={cls}>Purchase Orders</NavLink>
      <NavLink to={`/c/${slug}/procurement/suppliers`} className={cls}>Suppliers</NavLink>
      <NavLink to={`/c/${slug}/procurement/match`} className={cls}>3-Way Match</NavLink>
      <NavLink to={`/c/${slug}/procurement/trends`} className={cls}>Trends</NavLink>
    </nav>
  );
}
