import { Link, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import { PageShell } from './UserLogin';

export default function UserAccount() {
  const { slug } = useParams<{ slug: string }>();
  const { user, client, signOut } = useUserAuth();

  if (!user || !client) return null;

  return (
    <PageShell>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Hello, {user.display_name}</h1>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          {client.name} · {user.role.label}
        </p>
      </header>

      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>Your account</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Email: <strong>{user.email}</strong>
        </p>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          Role: <strong>{user.role.label}</strong>
        </p>
      </div>

      <p className="muted" style={{ fontSize: 13 }}>
        Workspace features (bookings, data, profile management) are coming soon.
        Your account is set up and ready.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Link to={`/c/${slug}/change-password`} className="btn btn-secondary">Change password</Link>
        <button className="btn btn-ghost" onClick={() => { void signOut(); }}>Sign out</button>
      </div>
    </PageShell>
  );
}
