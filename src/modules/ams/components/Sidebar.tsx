import { NavLink } from 'react-router-dom';
import { useAuth } from '../../../lib/auth-context';

export function Sidebar() {
  const { admin, signOut } = useAuth();

  return (
    <aside className="sidebar">
      <h2>ExSol</h2>
      <nav>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/file-manager">File Manager</NavLink>
        <NavLink to="/files">Files</NavLink>
        <NavLink to="/audit">Audit</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
      <div className="footer">
        Signed in as<br />
        <strong>{admin?.email}</strong><br />
        <button className="btn btn-ghost" style={{ padding: '4px 0' }} onClick={() => void signOut()}>Sign out</button>
      </div>
    </aside>
  );
}
