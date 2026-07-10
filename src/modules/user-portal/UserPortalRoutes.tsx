import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { UserAuthProvider, useUserAuth } from './user-auth-context';

// Layout: provides UserAuthProvider context to all /c/:slug/* routes.
// Has NO admin sidebar — these are end-user pages.
export function UserPortalLayout() {
  return (
    <UserAuthProvider>
      <Outlet />
    </UserAuthProvider>
  );
}

// Gate: requires a logged-in bucket user. Redirects to the universal login otherwise.
// Also enforces the "must_change_password → /change-password" flow.
export function RequireBucketUser() {
  const { user, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;

  // Block any path other than /change-password until the user has reset their
  // temp password. The change-password page itself is allowed through.
  if (user.must_change_password && !location.pathname.endsWith('/change-password')) {
    return <Navigate to={`/c/${slug}/change-password`} replace />;
  }
  return <Outlet />;
}
