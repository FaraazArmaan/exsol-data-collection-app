import { Link, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import { useNavItems } from '../nav/useNavItems';

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card tile">
      <div className="tile-stat-label">{label}</div>
      <div className="tile-stat-value">{value}</div>
    </div>
  );
}

function StubTile({ title, description }: { title: string; description: string }) {
  return (
    <div className="card tile tile-disabled" title="Coming soon" aria-disabled="true">
      <div className="tile-title">{title}</div>
      <div className="tile-sub">{description}</div>
      <div className="tile-disabled-badge">Coming soon</div>
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
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Welcome back, {user.display_name}</h1>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          {client.name} · {user.role.label}
        </p>
      </header>

      <section className="tile-row">
        <StatTile label="Role" value={user.role.label} />
        <StatTile label="Modules available" value={navItems.length} />
        <StatTile label="Workspace" value={client.name} />
      </section>

      <section>
        <h2 className="section-title">Quick actions</h2>
        <div className="tile-row">
          {navItems.map((item) => (
            <Link key={item.moduleKey} to={item.href} className="card tile tile-link">
              <div className="tile-title">{item.label}</div>
              <div className="tile-sub">Open module</div>
            </Link>
          ))}
          {isOwner && (
            <>
              <Link to={`/c/${slug}/team`} className="card tile tile-link">
                <div className="tile-title">Manage team</div>
                <div className="tile-sub">Add, edit, and remove users in your workspace.</div>
              </Link>
              <StubTile title="Settings" description="Configure workspace preferences and integrations." />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
