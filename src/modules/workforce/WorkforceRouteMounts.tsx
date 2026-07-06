import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import WorkforcePage from './workspace/pages/WorkforcePage';
import ProjectsPage from './workspace/pages/ProjectsPage';
import ProjectDetailPage from './workspace/pages/ProjectDetailPage';
import TimesheetsPage from './workspace/pages/TimesheetsPage';

// L1 Owner (or legacy null-level) is all-on — consistent with the backend
// requireWorkforce bypass and every other gate in the codebase (Iron Rule 2).
const ALL_WORKFORCE_PERMS = [
  'workforce.employees.view', 'workforce.employees.create',
  'workforce.employees.edit', 'workforce.employees.delete',
  'project-service.business.view', 'project-service.business.create',
  'project-service.business.edit', 'project-service.business.delete',
  'project-service.customers.view',
];

function useAuthBits() {
  const { user, client, permissions, enabledModules, loading } = useUserAuth();
  const { slug } = useParams<{ slug: string }>();
  const isOwner = !!user && (user.level_number === 1 || user.level_number == null);
  const perms = useMemo(
    () =>
      isOwner
        ? new Set(ALL_WORKFORCE_PERMS)
        : new Set(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k)),
    [permissions, isOwner],
  );
  const workforceEnabled = enabledModules.some((m) => m.key === 'workforce');
  return { user, client, perms, workforceEnabled, slug: slug ?? '', loading };
}

// Enable-gate THEN permission — same order as the backend and Sidebar.
export function WorkforceMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('workforce.employees.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <WorkforcePage slug={slug} perms={perms} />;
}

export function WorkforceProjectsMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('project-service.business.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <ProjectsPage slug={slug} perms={perms} />;
}

export function WorkforceProjectDetailMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  const { projectId } = useParams<{ projectId: string }>();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('project-service.business.view')) return <Navigate to={`/c/${slug}`} replace />;
  if (!projectId) return <Navigate to={`/c/${slug}/workforce/projects`} replace />;
  return <ProjectDetailPage slug={slug} projectId={projectId} perms={perms} />;
}

export function WorkforceTimesheetsMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('workforce.employees.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <TimesheetsPage slug={slug} perms={perms} />;
}
