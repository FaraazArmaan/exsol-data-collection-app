import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import HrPage from './pages/HrPage';
import { ALL_HR_PERMS } from './shared/permissions';

// Enable-gate THEN permission — same order as the backend requireHr and the
// manifest-driven Sidebar. L1 Owner (level 1 or legacy null) is all-on.
function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () => (isOwner
      ? new Set<string>(ALL_HR_PERMS)
      : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k))),
    [permissions, isOwner],
  );
  const hrEnabled = enabledModules.some((m) => m.key === 'hr');
  return { user, client, perms, hrEnabled, slug: slug ?? '', loading };
}

export function HrMount() {
  const { user, client, perms, hrEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!hrEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('hr.employees.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <HrPage slug={slug} perms={perms} />;
}
