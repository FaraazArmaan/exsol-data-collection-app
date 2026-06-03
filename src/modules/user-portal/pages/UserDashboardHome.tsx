import { Link, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import { useNavItems } from '../nav/useNavItems';

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card" style={{ padding: 16, flex: 1, minWidth: 160 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function StubTile({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="card"
      title="Coming soon"
      style={{
        padding: 16,
        flex: 1,
        minWidth: 180,
        opacity: 0.6,
        cursor: 'not-allowed',
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{description}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Coming soon</div>
    </div>
  );
}

export default function UserDashboardHome() {
  const { slug } = useParams<{ slug: string }>();
  const { user, client } = useUserAuth();
  const navItems = useNavItems();

  if (!user || !client || !slug) return null;

  const isOwner = user.level_number == null || user.level_number === 1;

  return (
    <div style={{ maxWidth: 960 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Welcome back, {user.display_name}</h1>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          {client.name} · {user.role.label}
        </p>
      </header>

      <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label="Role" value={user.role.label} />
        <StatTile label="Modules available" value={navItems.length} />
        <StatTile label="Workspace" value={client.name} />
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Quick actions</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {navItems.map((item) => (
            <Link
              key={item.moduleKey}
              to={item.href}
              className="card"
              style={{
                padding: 16,
                flex: 1,
                minWidth: 180,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ fontWeight: 600 }}>{item.label}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Open module</div>
            </Link>
          ))}
          {isOwner && (
            <>
              <StubTile title="Manage team" description="Add, edit, and remove users in your workspace." />
              <StubTile title="Settings" description="Configure workspace preferences and integrations." />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
