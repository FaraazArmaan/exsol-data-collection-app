import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth-context';
import LoginPage from '../modules/login/pages/LoginPage';
import { Sidebar } from '../modules/ams/components/Sidebar';
import AdminDashboard from '../modules/ams/pages/AdminDashboard';
import AdminSettings from '../modules/ams/pages/AdminSettings';
import AccessDashboard from '../modules/ams/pages/AccessDashboard';
import AccessLevelDashboard from '../modules/ams/pages/AccessLevelDashboard';
import ConfigureStructure from '../modules/ams/pages/ConfigureStructure';
import UserLogin from '../modules/user-portal/pages/UserLogin';
import UserChangePassword from '../modules/user-portal/pages/UserChangePassword';
import UserAccount from '../modules/user-portal/pages/UserAccount';
import { UserPortalLayout, RequireBucketUser } from '../modules/user-portal/UserPortalRoutes';

function ShellLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main"><Outlet /></main>
    </div>
  );
}

function RequireAdmin() {
  const { admin, loading } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!admin) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <ShellLayout />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/c/:slug',
    element: <UserPortalLayout />,
    children: [
      { path: 'login', element: <UserLogin /> },
      {
        element: <RequireBucketUser />,
        children: [
          { index: true, element: <UserAccount /> },
          { path: 'change-password', element: <UserChangePassword /> },
        ],
      },
    ],
  },
  {
    element: <RequireAdmin />,
    children: [
      { path: '/', element: <AdminDashboard /> },
      { path: '/settings', element: <AdminSettings /> },
      { path: '/clients/:clientId', element: <AccessDashboard /> },
      { path: '/clients/:clientId/access-levels', element: <AccessLevelDashboard /> },
      { path: '/clients/:clientId/configure', element: <ConfigureStructure /> },
    ],
  },
]);
