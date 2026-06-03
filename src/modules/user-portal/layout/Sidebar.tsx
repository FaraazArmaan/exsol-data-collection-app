import { NavLink, useParams } from 'react-router-dom';
import { useNavItems } from '../nav/useNavItems';
import { useUserAuth } from '../user-auth-context';

export function Sidebar() {
  const { slug } = useParams<{ slug: string }>();
  const items = useNavItems();
  const { user } = useUserAuth();
  if (!slug) return null;

  const isOwner = user && (user.level_number == null || user.level_number === 1);

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

        {isOwner && (
          <>
            <div className="nav-group-header">Workspace</div>
            <NavLink to={`/c/${slug}/team`}>Team</NavLink>
          </>
        )}

        <NavLink to={`/c/${slug}/account`} className="sidebar-nav-footer">
          Account
        </NavLink>
      </nav>
    </aside>
  );
}
