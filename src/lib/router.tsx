import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth-context';
import LoginPage from '../modules/login/pages/LoginPage';
import StorefrontLayout from '../modules/pos/pages/StorefrontLayout';
import StorefrontMenuPage from '../modules/pos/pages/StorefrontMenuPage';
import StorefrontCartPage from '../modules/pos/pages/StorefrontCartPage';
import StorefrontDetailsPage from '../modules/pos/pages/StorefrontDetailsPage';
import StorefrontReceiptPage from '../modules/pos/pages/StorefrontReceiptPage';
import StorefrontSettings from '../modules/pos/pages/StorefrontSettings';
import { Sidebar } from '../modules/ams/components/Sidebar';
import AdminDashboard from '../modules/ams/pages/AdminDashboard';
import AdminSettings from '../modules/ams/pages/AdminSettings';
import AccessDashboard from '../modules/ams/pages/AccessDashboard';
import AccessLevelDashboard from '../modules/ams/pages/AccessLevelDashboard';
import ConfigureStructure from '../modules/ams/pages/ConfigureStructure';
import AuditLog from '../modules/ams/pages/AuditLog';
import ClientAuditLog from '../modules/ams/pages/ClientAuditLog';
import FilesPage from '../modules/ams/pages/FilesPage';
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
import ProductsListPage from '../modules/products/workspace/pages/ProductsListPage';
import ProductEditPage from '../modules/products/workspace/pages/ProductEditPage';
import ProductCategoriesPage from '../modules/products/workspace/pages/ProductCategoriesPage';
import { WorkspaceProductsScopeProvider } from '../modules/products/shared/scope';
import AdminProductsListPage from '../modules/products/admin/AdminProductsListPage';
import AdminProductEditPage from '../modules/products/admin/AdminProductEditPage';
import AdminProductCategoriesPage from '../modules/products/admin/AdminProductCategoriesPage';
import { PosMenuMount, PosCartMount, PosSalesMount } from '../modules/pos/PosRouteMounts';
// Lazy-loaded so the analytics bundle (incl. recharts) is a separate chunk
// fetched only when a user opens Analytics — keeps the main bundle lean.
const AnalyticsRouteMount = lazy(() => import('../modules/analytics/AnalyticsRouteMount'));
import BookingStorefront from '../modules/booking/public/BookingStorefront';
import ManageBooking from '../modules/booking/public/ManageBooking';
import {
  BookingCalendarMount, BookingListMount, BookingServicesMount, BookingResourcesMount, BookingSettingsMount,
} from '../modules/booking/BookingRouteMounts';
import { InventoryListMount } from '../modules/inventory/InventoryRouteMounts';
import { ManufacturingMount } from '../modules/manufacturing/ManufacturingRouteMounts';
import { EmailOutboxMount } from '../modules/email/EmailRouteMounts';
import { FinanceMount } from '../modules/finance/FinanceRouteMounts';
import {
  ProcurementOrdersMount, ProcurementSuppliersMount, ProcurementOrderDetailMount,
} from '../modules/procurement/ProcurementRouteMounts';
import { WarehouseMount } from '../modules/warehouse/WarehouseRouteMounts';
import { CrmListMount, CrmDetailMount } from '../modules/crm/CrmRouteMounts';
import {
  WorkforceMount, WorkforceProjectsMount, WorkforceProjectDetailMount,
} from '../modules/workforce/WorkforceRouteMounts';

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
  // Public storefront — unauthenticated, mounted OUTSIDE /c/:slug (no portal
  // shell, no auth). See POS v2 storefront design §3.3. The StorefrontLayout
  // wraps all four steps in one shared BrandShell (brand fetched once for the
  // whole guest flow); see branding spec §9.4.
  {
    path: '/menu/:slug',
    element: <StorefrontLayout />,
    children: [
      { index: true, element: <StorefrontMenuPage /> },
      { path: 'cart', element: <StorefrontCartPage /> },
      { path: 'details', element: <StorefrontDetailsPage /> },
      { path: 'order/:saleUuid', element: <StorefrontReceiptPage /> },
    ],
  },
  {
    path: '/c/:slug',
    element: <UserPortalLayout />,
    children: [
      { path: 'login', element: <UserLogin /> },
      // Anonymous booking storefront — sibling of login, OUTSIDE the auth gate.
      { path: 'book', element: <BookingStorefront /> },
      { path: 'book/manage/:token', element: <ManageBooking /> },
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
              { path: 'file-manager', element: <WorkspaceFilesPage /> },
              {
                element: (
                  <WorkspaceProductsScopeProvider>
                    <Outlet />
                  </WorkspaceProductsScopeProvider>
                ),
                children: [
                  { path: 'products', element: <ProductsListPage /> },
                  { path: 'products/new', element: <ProductEditPage /> },
                  { path: 'products/:productId/edit', element: <ProductEditPage /> },
                  { path: 'products/categories', element: <ProductCategoriesPage /> },
                ],
              },
              { path: 'pos', element: <Navigate to="menu" replace /> },
              { path: 'pos/menu', element: <PosMenuMount /> },
              { path: 'pos/cart', element: <PosCartMount /> },
              { path: 'pos/sales', element: <PosSalesMount /> },
              { path: 'pos/sales/:id', element: <PosSalesMount /> },
              { path: 'pos/settings', element: <StorefrontSettings /> },
              { path: 'booking', element: <BookingCalendarMount /> },
              { path: 'booking/list', element: <BookingListMount /> },
              { path: 'booking/services', element: <BookingServicesMount /> },
              { path: 'booking/resources', element: <BookingResourcesMount /> },
              { path: 'booking/settings', element: <BookingSettingsMount /> },
              { path: 'inventory', element: <InventoryListMount /> },
              { path: 'manufacturing', element: <ManufacturingMount /> },
              { path: 'crm', element: <CrmListMount /> },
              { path: 'crm/:id', element: <CrmDetailMount /> },
              { path: 'analytics', element: (
                <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
                  <AnalyticsRouteMount />
                </Suspense>
              ) },
              { path: 'email', element: <EmailOutboxMount /> },
              { path: 'finance', element: <FinanceMount /> },
              { path: 'procurement', element: <ProcurementOrdersMount /> },
              { path: 'procurement/suppliers', element: <ProcurementSuppliersMount /> },
              { path: 'procurement/orders/:id', element: <ProcurementOrderDetailMount /> },
              { path: 'warehouse', element: <WarehouseMount /> },
              { path: 'workforce', element: <WorkforceMount /> },
              { path: 'workforce/projects', element: <WorkforceProjectsMount /> },
              { path: 'workforce/projects/:projectId', element: <WorkforceProjectDetailMount /> },
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
      { path: '/file-manager', element: <AdminFilesPage /> },
      { path: '/files', element: <FilesPage /> },
      { path: '/audit', element: <AuditLog /> },
      { path: '/settings', element: <AdminSettings /> },
      { path: '/clients/:clientId', element: <AccessDashboard /> },
      { path: '/clients/:clientId/audit', element: <ClientAuditLog /> },
      { path: '/clients/:clientId/access-levels', element: <AccessLevelDashboard /> },
      { path: '/clients/:clientId/configure', element: <ConfigureStructure /> },
      { path: '/clients/:clientId/products', element: <AdminProductsListPage /> },
      { path: '/clients/:clientId/products/new', element: <AdminProductEditPage /> },
      { path: '/clients/:clientId/products/:productId/edit', element: <AdminProductEditPage /> },
      { path: '/clients/:clientId/products/categories', element: <AdminProductCategoriesPage /> },
    ],
  },
]);
