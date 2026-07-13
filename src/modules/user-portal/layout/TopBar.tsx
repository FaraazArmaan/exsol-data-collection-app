import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';

export function TopBar() {
  const { user, client, signOut } = useUserAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  if (!user || !client) return null;

  async function handleSignOut() {
    setMenuOpen(false);
    document.cookie = 'imp_ctx=; Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = 'imp_actor=; Path=/; Max-Age=0; SameSite=Lax';
    navigate('/login', { replace: true });
    await signOut();
  }

  return (
    <header className="topbar">
      <div className="topbar-title">{client.name}</div>

      <div className="dropdown" ref={menuRef}>
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
          <div className="dropdown-menu">
            <Link
              to={`/c/${client.slug}/account`}
              className="dropdown-item"
              onClick={() => setMenuOpen(false)}
            >
              Account
            </Link>
            <button
              type="button"
              className="dropdown-item"
              onClick={() => { void handleSignOut(); }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
