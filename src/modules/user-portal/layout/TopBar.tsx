import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppearance, type Appearance } from '../../../lib/appearance';
import { useUserAuth } from '../user-auth-context';

export function TopBar() {
  const { user, client, signOut } = useUserAuth();
  const navigate = useNavigate();
  const { appearance, setAppearance } = useAppearance();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
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

  function chooseAppearance(next: Appearance) {
    setAppearance(next);
    setMenuOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <header className="topbar">
      <div className="topbar-title">{client.name}</div>

      <div className="dropdown" ref={menuRef}>
        <button
          ref={triggerRef}
          className="btn btn-ghost"
          onClick={() => setMenuOpen((o) => !o)}
          aria-controls={menuId}
          aria-expanded={menuOpen}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {user.display_name}
          <span aria-hidden style={{ fontSize: 10 }}>▾</span>
        </button>

        {menuOpen && (
          <div id={menuId} className="dropdown-menu" aria-label="Account preferences">
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
            <div className="ui-appearance-menu" aria-label="Appearance">
              <span>Appearance</span>
              {(['system', 'light', 'dark'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="dropdown-item ui-appearance-menu__choice"
                  aria-pressed={appearance === option}
                  onClick={() => chooseAppearance(option)}
                >
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
