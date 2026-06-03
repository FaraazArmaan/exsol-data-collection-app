import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';

export function TopBar() {
  const { slug } = useParams<{ slug: string }>();
  const { user, client, signOut } = useUserAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!user || !client) return null;

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
    navigate(`/c/${slug}/login`, { replace: true });
  }

  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontWeight: 600 }}>{client.name}</div>

      <div style={{ position: 'relative' }}>
        <button
          className="btn btn-ghost"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {user.display_name}
          <span aria-hidden style={{ fontSize: 10 }}>▾</span>
        </button>

        {menuOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 4px)',
              minWidth: 160,
              background: 'var(--surface, #1a1a1a)',
              border: '1px solid var(--border, rgba(255,255,255,0.12))',
              borderRadius: 6,
              padding: 4,
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Link
              to={`/c/${slug}/account`}
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              style={{ padding: '8px 12px', textDecoration: 'none', color: 'inherit', borderRadius: 4 }}
            >
              Account
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => { void handleSignOut(); }}
              style={{ textAlign: 'left', padding: '8px 12px', background: 'transparent', border: 0, color: 'inherit', borderRadius: 4, cursor: 'pointer' }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
