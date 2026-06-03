import { NavLink, useParams } from 'react-router-dom';
import { useNavItems } from '../nav/useNavItems';

export function Sidebar() {
  const { slug } = useParams<{ slug: string }>();
  const items = useNavItems();
  if (!slug) return null;

  return (
    <aside className="sidebar">
      <nav aria-label="Primary" className="sidebar-nav-grow">
        <NavLink to={`/c/${slug}`} end>Dashboard</NavLink>

        {items.length > 0 && (
          <>
            <div className="nav-group-header">Modules</div>
            {items.map((item) => (
              <NavLink key={item.moduleKey} to={item.href}>
                {item.label}
              </NavLink>
            ))}
          </>
        )}

        <NavLink to={`/c/${slug}/account`} className="sidebar-nav-footer">
          Account
        </NavLink>
      </nav>
    </aside>
  );
}
