import { NavLink, useParams } from 'react-router-dom';
import { useNavItems } from '../nav/useNavItems';

const linkStyle: React.CSSProperties = {
  display: 'block',
  padding: '8px 12px',
  borderRadius: 6,
  color: 'inherit',
  textDecoration: 'none',
  fontSize: 14,
};
const activeStyle: React.CSSProperties = {
  background: 'var(--surface-hover, rgba(255,255,255,0.06))',
  fontWeight: 600,
};

function navLinkStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
  return isActive ? { ...linkStyle, ...activeStyle } : linkStyle;
}

export function Sidebar() {
  const { slug } = useParams<{ slug: string }>();
  const items = useNavItems();
  if (!slug) return null;

  return (
    <nav
      aria-label="Primary"
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--border, rgba(255,255,255,0.08))',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      <NavLink to={`/c/${slug}`} end style={navLinkStyle}>Dashboard</NavLink>

      {items.length > 0 && (
        <>
          <div
            className="muted"
            style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, padding: '12px 12px 4px' }}
          >
            Modules
          </div>
          {items.map((item) => (
            <NavLink key={item.moduleKey} to={item.href} style={navLinkStyle}>
              {item.label}
            </NavLink>
          ))}
        </>
      )}

      <div style={{ flex: 1 }} />

      <NavLink to={`/c/${slug}/account`} style={navLinkStyle}>Account</NavLink>
    </nav>
  );
}
