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

  // Inventory appears only when the workspace has it enabled AND the caller is an
  // Owner (all-on) or holds the inventory view permission. Mirrors POS/Booking.
  const inventoryEnabled = enabledModules.some((m) => m.key === 'inventory');
  const showInventory = inventoryEnabled && (
    isOwner ||
    permissions['inventory.products.view'] === true
  );

  // Sale History needs pos.history.view (Owners always qualify) — surfaced as a
  // sibling sidebar link so staff can reach orders, not just the menu.
  const canViewSales = !!user && (
    user.level_number == null ||
    user.level_number === 1 ||
    permissions['pos.history.view'] === true
  );

  // Storefront settings is an Owner-level workspace config (same gate as the
  // StorefrontSettings page). Lives in the Workspace group.
  const canEditSettings = !!user && (
    user.level_number == null ||
    user.level_number === 1 ||
    permissions['_platform.settings.edit'] === true
  );

  // CRM appears only when the workspace has it enabled AND the caller is an
  // Owner (all-on) or holds the CRM customers view permission. Mirrors Booking.
  const crmEnabled = enabledModules.some((m) => m.key === 'crm');
  const showCrm = crmEnabled && (isOwner || permissions['crm.customers.view'] === true);

  // Analytics appears when the workspace has it enabled AND the caller is an
  // Owner (all-on) or holds any analytics view permission. Mirrors POS/Booking.
  const analyticsEnabled = enabledModules.some((m) => m.key === 'analytics');
  const showAnalytics = analyticsEnabled && (
    isOwner ||
    permissions['analytics.business.view'] === true ||
    permissions['analytics.customers.view'] === true ||
    permissions['analytics.employees.view'] === true ||
    permissions['analytics.products.view'] === true
  );

  // Email/Notifications appears when the workspace has it enabled AND the caller
  // is an Owner (all-on) or holds the outbox view permission. Mirrors POS/Booking.
  const emailEnabled = enabledModules.some((m) => m.key === 'email');
  const showEmail = emailEnabled && (
    isOwner ||
    permissions['email.customers.view'] === true
  );

  // Finance appears when the workspace has it enabled AND the caller is an Owner
  // (all-on) or holds the finance view permission. Mirrors POS/Booking/Analytics.
  const financeEnabled = enabledModules.some((m) => m.key === 'finance');
  const showFinance = financeEnabled && (
    isOwner ||
    permissions['finance.business.view'] === true
  );

  // Procurement appears when the workspace has it enabled AND the caller is an
  // Owner (all-on) or holds the procurement view permission. Mirrors the others.
  const procurementEnabled = enabledModules.some((m) => m.key === 'procurement');
  const showProcurement = procurementEnabled && (
    isOwner ||
    permissions['procurement.products.view'] === true
  );

  // Warehouse appears when the workspace has it enabled AND the caller is an Owner
  // (all-on) or can view locations/stock. Mirrors POS/Booking/Inventory.
  const warehouseEnabled = enabledModules.some((m) => m.key === 'warehouse');
  const showWarehouse = warehouseEnabled && (
    isOwner ||
    permissions['warehouse.business.view'] === true ||
    permissions['warehouse.products.view'] === true
  );

  // Workforce appears when the 'workforce' product is enabled AND the caller is
  // an Owner (all-on) or holds a workforce/project-service view permission.
  const workforceEnabled = enabledModules.some((m) => m.key === 'workforce');
  const showWorkforce = workforceEnabled && (
    isOwner ||
    permissions['workforce.employees.view'] === true ||
    permissions['project-service.business.view'] === true
  );

  return (
    <aside className="sidebar">
      <nav aria-label="Primary" className="sidebar-nav-grow">
        <NavLink to={`/c/${slug}`} end>Dashboard</NavLink>
        <NavLink to={`/c/${slug}/file-manager`}>File Manager</NavLink>

        {(showProducts || showPos || showBooking || showInventory || showCrm || showAnalytics || showEmail || showFinance || showProcurement || showWarehouse || showWorkforce || items.length > 0) && (
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
            {showInventory && (
              <NavLink to={`/c/${slug}/inventory`}>Inventory</NavLink>
            )}
            {showCrm && (
              <NavLink to={`/c/${slug}/crm`}>CRM</NavLink>
            )}
            {showPos && canViewSales && (
              <NavLink to={`/c/${slug}/pos/sales`}>Orders</NavLink>
            )}
            {showAnalytics && (
              <NavLink to={`/c/${slug}/analytics`}>Analytics</NavLink>
            )}
            {showEmail && (
              <NavLink to={`/c/${slug}/email`}>Email</NavLink>
            )}
            {showFinance && (
              <NavLink to={`/c/${slug}/finance`}>Finance</NavLink>
            )}
            {showProcurement && (
              <NavLink to={`/c/${slug}/procurement`}>Procurement</NavLink>
            )}
            {showWarehouse && (
              <NavLink to={`/c/${slug}/warehouse`}>Warehouse</NavLink>
            )}
            {showWorkforce && (
              <NavLink to={`/c/${slug}/workforce`}>Workforce</NavLink>
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
