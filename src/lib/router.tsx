import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth-context';
import LoginPage from '../modules/login/pages/LoginPage';
import { Sidebar } from '../modules/ams/components/Sidebar';
import AdminDashboard from '../modules/ams/pages/AdminDashboard';
import AdminSettings from '../modules/ams/pages/AdminSettings';
import AccessDashboard from '../modules/ams/pages/AccessDashboard';
import AccessLevelDashboard from '../modules/ams/pages/AccessLevelDashboard';
import ConfigureStructure from '../modules/ams/pages/ConfigureStructure';
import AuditLog from '../modules/ams/pages/AuditLog';
import ClientAuditLog from '../modules/ams/pages/ClientAuditLog';
import UserLogin from '../modules/user-portal/pages/UserLogin';
import UserChangePassword from '../modules/user-portal/pages/UserChangePassword';
import UserAccount from '../modules/user-portal/pages/UserAccount';
import UserDashboardHome from '../modules/user-portal/pages/UserDashboardHome';
import ModuleStub from '../modules/user-portal/pages/ModuleStub';
import UserManageTeam from '../modules/user-portal/pages/UserManageTeam';
import { UserPortalLayout, RequireBucketUser } from '../modules/user-portal/UserPortalRoutes';
import { UserDashboardLayout } from '../modules/user-portal/layout/UserDashboardLayout';
import AdminFilesPage from '../modules/files/admin/AdminFilesPage';
import WorkspaceFilesPage from '../modules/files/workspace/WorkspaceFilesPage';

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
          // Change-password stays outside dashboard chrome — the forced-reset
          // flow should not look like a fully-furnished workspace.
          { path: 'change-password', element: <UserChangePassword /> },
          {
            element: <UserDashboardLayout />,
            children: [
              { index: true, element: <UserDashboardHome /> },
              { path: 'account', element: <UserAccount /> },
              { path: 'team', element: <UserManageTeam /> },
              { path: 'files', element: <WorkspaceFilesPage /> },
              { path: 'm/:moduleKey', element: <ModuleStub /> },
            ],
          },
        ],
      },
    ],
  },
  {
    element: <RequireAdmin />,
    children: [
      { path: '/', element: <AdminDashboard /> },
      { path: '/files', element: <AdminFilesPage /> },
      { path: '/settings', element: <AdminSettings /> },
      { path: '/audit', element: <AuditLog /> },
      { path: '/clients/:clientId', element: <AccessDashboard /> },
      { path: '/clients/:clientId/audit', element: <ClientAuditLog /> },
      { path: '/clients/:clientId/access-levels', element: <AccessLevelDashboard /> },
      { path: '/clients/:clientId/configure', element: <ConfigureStructure /> },
    ],
  },
]);
