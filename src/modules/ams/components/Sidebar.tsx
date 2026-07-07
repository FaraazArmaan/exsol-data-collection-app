import { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useAuth } from '../../../lib/auth-context';
import { enabledModulesForProducts } from '@registry/products';
import { getModule } from '@registry/modules';

// A "view as client" link: the enabled module the admin can jump into. Clicking
// mints an Owner (bucket-user) session for the client and lands on that module.
interface ModuleLink { key: string; label: string; path: string; }

export function Sidebar() {
  const { admin, signOut } = useAuth();
  const params = useParams<{ clientId?: string }>();
  const clientId = params.clientId;
  const inClient = Boolean(clientId);

  const [modules, setModules] = useState<ModuleLink[]>([]);
  const [impersonating, setImpersonating] = useState<string | null>(null);
  const [impErr, setImpErr] = useState(false);

  // When viewing a client, load its enabled products → modules (registry-derived,
  // exactly what the client's own users see). Each becomes a "view as" jump.
  useEffect(() => {
    if (!clientId) { setModules([]); return; }
    let cancelled = false;
    void (async () => {
      const r = await fetch(`/api/admin-client-products?client=${encodeURIComponent(clientId)}`, { credentials: 'same-origin' });
      if (!r.ok || cancelled) return;
      const body = await r.json() as { enabled_keys: string[] };
      const links: ModuleLink[] = [];
      for (const m of enabledModulesForProducts(body.enabled_keys)) {
        const path = getModule(m.key)?.navLinks?.[0]?.path;
        if (path) links.push({ key: m.key, label: m.label, path });
      }
      if (!cancelled) setModules(links);
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  // Mint an Owner session for this client and open the module. Full page load so
  // the workspace boots fresh with the new bu_session cookie.
  async function viewAsClient(mod: ModuleLink) {
    if (!clientId) return;
    setImpErr(false);
    setImpersonating(mod.key);
    try {
      const r = await fetch('/api/admin-impersonate', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      if (!r.ok) { setImpErr(true); setImpersonating(null); return; }
      const { slug, name } = await r.json() as { slug: string; name: string };
      // Non-HttpOnly banner flag the workspace reads; cleared on exit.
      document.cookie = `imp_ctx=${encodeURIComponent(name)}; Path=/; SameSite=Lax; Max-Age=${24 * 60 * 60}`;
      window.location.href = `/c/${slug}${mod.path}`;
    } catch {
      setImpErr(true); setImpersonating(null);
    }
  }

  return (
    <aside className="sidebar">
      <h2>ExSol</h2>
      <nav>
        {inClient ? (
          <>
            <NavLink to={`/clients/${clientId}`} end>Dashboard</NavLink>
            <NavLink to={`/clients/${clientId}/products`}>Product Manager</NavLink>
            <NavLink to={`/clients/${clientId}/audit`}>Audit</NavLink>
            <NavLink to={`/clients/${clientId}/settings`}>Settings</NavLink>

            {modules.length > 0 && (
              <>
                <div className="sidebar-section-label">Modules (view as client)</div>
                {modules.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className="sidebar-module-link"
                    disabled={impersonating !== null}
                    onClick={() => void viewAsClient(m)}
                  >
                    {impersonating === m.key ? `Opening ${m.label}…` : m.label}
                  </button>
                ))}
                {impErr && <div className="sidebar-imp-err">Couldn’t open the workspace. Try again.</div>}
              </>
            )}

            <NavLink to="/" className="sidebar-back">← back to admin</NavLink>
          </>
        ) : (
          <>
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/file-manager">File Manager</NavLink>
            <NavLink to="/files">Files</NavLink>
            <NavLink to="/audit">Audit</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </>
        )}
      </nav>
      <div className="footer">
        Signed in as<br />
        <strong>{admin?.email}</strong><br />
        <button className="btn btn-ghost" style={{ padding: '4px 0' }} onClick={() => void signOut()}>Sign out</button>
      </div>
    </aside>
  );
}
