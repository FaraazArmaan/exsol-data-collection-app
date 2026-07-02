import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import EmailOutboxPage from './EmailOutboxPage';

// Mirrors BookingRouteMounts: enable-gate + L1 Owner bypass, in the same order
// as the backend requireEmail helper.
const ALL_EMAIL_PERMS = ['email.customers.view'];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set(ALL_EMAIL_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const emailEnabled = enabledModules.some((m) => m.key === 'email');
  return { user, client, perms, emailEnabled, slug: slug ?? '', loading };
}

function gate(perm: string, render: (slug: string, perms: ReadonlySet<string>) => JSX.Element) {
  return function Mount() {
    const { user, client, perms, emailEnabled, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!emailEnabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return render(slug, perms);
  };
}

export const EmailOutboxMount = gate('email.customers.view', (slug, perms) => (
  <EmailOutboxPage slug={slug} perms={perms} />
));
