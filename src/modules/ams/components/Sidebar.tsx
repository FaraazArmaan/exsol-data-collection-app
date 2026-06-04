import { NavLink, useParams } from 'react-router-dom';
import { useAuth } from '../../../lib/auth-context';

export function Sidebar() {
  const { admin, signOut } = useAuth();
  const params = useParams<{ clientId?: string }>();
  const inClient = Boolean(params.clientId);

  return (
    <aside className="sidebar">
      <h2>ExSol</h2>
      <nav>
        {inClient ? (
          <>
            <NavLink to={`/clients/${params.clientId}`} end>Dashboard</NavLink>
            <NavLink to={`/clients/${params.clientId}/audit`}>Audit</NavLink>
            <NavLink to={`/clients/${params.clientId}/settings`}>Settings</NavLink>
            <NavLink to="/">← back to admin</NavLink>
          </>
        ) : (
          <>
            <NavLink to="/" end>Dashboard</NavLink>
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
