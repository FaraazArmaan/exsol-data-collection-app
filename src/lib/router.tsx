import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth-context';
import LoginPage from '../modules/login/pages/LoginPage';

function RequireAdmin() {
  const { admin, loading } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!admin) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <Outlet />;
}

function Placeholder({ label }: { label: string }) {
  return <main style={{ padding: 24 }}><h2>{label}</h2><p>Coming in Phase 4.</p></main>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAdmin />,
    children: [
      { path: '/', element: <Placeholder label="Admin Dashboard" /> },
      { path: '/settings', element: <Placeholder label="Admin Settings" /> },
    ],
  },
]);
