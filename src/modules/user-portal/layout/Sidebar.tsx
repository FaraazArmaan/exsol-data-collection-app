import { NavLink, useParams } from 'react-router-dom';
import { allModules } from '@registry/modules';
import { useNavItems } from '../nav/useNavItems';
import { useUserAuth } from '../user-auth-context';

function isAdminFullAccessEntry(): boolean {
  const m = document.cookie.split(/;\s*/).find((c) => c.startsWith('imp_actor='));
  return m ? decodeURIComponent(m.slice('imp_actor='.length)) === 'admin' : false;
}

export function Sidebar() {
  const { slug } = useParams<{ slug: string }>();
  const items = useNavItems();
  const { user, permissions, enabledModules } = useUserAuth();
  const showAdminSettings = isAdminFullAccessEntry();
  if (!slug) return null;

  const isOwner = !!user && (user.level_number == null || user.level_number === 1);

  const canManageTeam = user && (
    isOwner ||
    permissions['_platform.users.view'] === true
  );

  // Storefront settings is an Owner-level workspace config (same gate as the
  // StorefrontSettings page). Lives in the Workspace group.
  const canEditSettings = !!user && (
    isOwner ||
    permissions['_platform.settings.edit'] === true
  );

  // Dedicated module links come from the registry manifests (`navLinks`) — the
  // single source of truth for which modules render their own sidebar entry.
  // A link renders when its module is enabled for the workspace (unless it
  // opts out via skipEnableCheck — Product Manager, a preserved legacy quirk)
  // AND the caller is an L1 Owner (all-on) or holds ANY of the link's view
  // permissions. `order` preserves the historical link order, including the
  // POS "Orders" link slotting in after Marketing.
  const enabledKeys = new Set(enabledModules.map((m) => m.key));
  const moduleLinks = user
    ? allModules()
        .flatMap((m) => (m.navLinks ?? []).map((link) => ({ moduleKey: m.key, link })))
        .filter(({ moduleKey, link }) => link.skipEnableCheck || enabledKeys.has(moduleKey))
        .filter(({ link }) => isOwner || link.viewKeys.some((k) => permissions[k] === true))
        .sort((a, b) => a.link.order - b.link.order)
    : [];

  return (
    <aside className="sidebar">
      <nav aria-label="Primary" className="sidebar-nav-grow">
        <NavLink to={`/c/${slug}`} end>Dashboard</NavLink>
        <NavLink to={`/c/${slug}/file-manager`}>File Manager</NavLink>

        {(moduleLinks.length > 0 || items.length > 0) && (
          <>
            <div className="nav-group-header">Modules</div>
            {moduleLinks.map(({ link }) => (
              <NavLink key={link.path} to={`/c/${slug}${link.path}`}>
                {link.label}
              </NavLink>
            ))}
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

        {showAdminSettings && (
          <>
            <div className="nav-group-header">Admin Settings</div>
            <NavLink to={`/c/${slug}/admin/audit`}>Audit</NavLink>
            <NavLink to={`/c/${slug}/admin/settings`}>Settings</NavLink>
          </>
        )}

        <NavLink to={`/c/${slug}/account`} className="sidebar-nav-footer">
          Account
        </NavLink>
      </nav>
    </aside>
  );
}
