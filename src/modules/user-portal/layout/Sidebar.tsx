import { NavLink, useParams } from 'react-router-dom';
import { useNavItems } from '../nav/useNavItems';
import { useUserAuth } from '../user-auth-context';
import { canViewProducts } from '../../products/shared/permissions';

export function Sidebar() {
  const { slug } = useParams<{ slug: string }>();
  const items = useNavItems();
  const { user, permissions } = useUserAuth();
  if (!slug) return null;

  const canManageTeam = user && (
    user.level_number == null ||
    user.level_number === 1 ||
    permissions['_platform.users.view'] === true
  );

  const showProducts = user && canViewProducts(permissions, user.level_number);

  const showPos = !!user && (
    permissions['pos.menu.view'] === true || permissions['pos.history.view'] === true
  );

  return (
    <aside className="sidebar">
      <nav aria-label="Primary" className="sidebar-nav-grow">
        <NavLink to={`/c/${slug}`} end>Dashboard</NavLink>
        <NavLink to={`/c/${slug}/file-manager`}>File Manager</NavLink>

        {(showProducts || showPos || items.length > 0) && (
          <>
            <div className="nav-group-header">Modules</div>
            {showProducts && (
              <NavLink to={`/c/${slug}/products`}>Product Manager</NavLink>
            )}
            {showPos && (
              <NavLink to={`/c/${slug}/pos/menu`}>POS</NavLink>
            )}
            {items.map((item) => (
              <NavLink key={item.moduleKey} to={item.href}>
                {item.label}
              </NavLink>
            ))}
          </>
        )}

        {canManageTeam && (
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
