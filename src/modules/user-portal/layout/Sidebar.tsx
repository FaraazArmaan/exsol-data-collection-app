import { NavLink, useParams } from 'react-router-dom';
import { useNavItems } from '../nav/useNavItems';
import { useUserAuth } from '../user-auth-context';
import { canViewProducts } from '../../products/shared/permissions';

export function Sidebar() {
  const { slug } = useParams<{ slug: string }>();
  const items = useNavItems();
  const { user, permissions, enabledModules } = useUserAuth();
  if (!slug) return null;

  const isOwner = !!user && (user.level_number == null || user.level_number === 1);

  const canManageTeam = user && (
    isOwner ||
    permissions['_platform.users.view'] === true
  );

  const showProducts = user && canViewProducts(permissions, user.level_number);

  // POS appears only when the workspace has it enabled AND the caller is an
  // Owner (all-on) or holds a POS view permission.
  const posEnabled = enabledModules.some((m) => m.key === 'pos');
  const showPos = posEnabled && (
    isOwner ||
    permissions['pos.menu.view'] === true ||
    permissions['pos.history.view'] === true
  );

  // Booking appears only when the workspace has it enabled AND the caller is an
  // Owner (all-on) or holds a booking view permission. Mirrors the POS gate above.
  const bookingEnabled = enabledModules.some((m) => m.key === 'booking');
  const showBooking = bookingEnabled && (
    isOwner ||
    permissions['booking.customers.view'] === true ||
    permissions['booking.employees.view'] === true
  );

  // Storefront settings is an Owner-level workspace config (same gate as the
  // StorefrontSettings page). Lives in the Workspace group.
  const canEditSettings = !!user && (
    user.level_number == null ||
    user.level_number === 1 ||
    permissions['_platform.settings.edit'] === true
  );

  return (
    <aside className="sidebar">
      <nav aria-label="Primary" className="sidebar-nav-grow">
        <NavLink to={`/c/${slug}`} end>Dashboard</NavLink>
        <NavLink to={`/c/${slug}/file-manager`}>File Manager</NavLink>

        {(showProducts || showPos || showBooking || items.length > 0) && (
          <>
            <div className="nav-group-header">Modules</div>
            {showProducts && (
              <NavLink to={`/c/${slug}/products`}>Product Manager</NavLink>
            )}
            {showPos && (
              <NavLink to={`/c/${slug}/pos/menu`}>POS</NavLink>
            )}
            {showBooking && (
              <NavLink to={`/c/${slug}/booking`}>Booking</NavLink>
            )}
            {items.map((item) => (
              <NavLink key={item.moduleKey} to={item.href}>
                {item.label}
              </NavLink>
            ))}
          </>
        )}

        {(canManageTeam || canEditSettings) && (
          <>
            <div className="nav-group-header">Workspace</div>
            {canManageTeam && <NavLink to={`/c/${slug}/team`}>Team</NavLink>}
            {canEditSettings && <NavLink to={`/c/${slug}/pos/settings`}>Storefront</NavLink>}
          </>
        )}

        <NavLink to={`/c/${slug}/account`} className="sidebar-nav-footer">
          Account
        </NavLink>
      </nav>
    </aside>
  );
}
