import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-portal/user-auth-context';
import WorkforcePage from './workspace/pages/WorkforcePage';
import ProjectsPage from './workspace/pages/ProjectsPage';
import ProjectDetailPage from './workspace/pages/ProjectDetailPage';
import TimesheetsPage from './workspace/pages/TimesheetsPage';
import LeaveRequestsPage from './workspace/pages/LeaveRequestsPage';
import SmartPunchingPage from './workspace/pages/SmartPunchingPage';
import OvertimePage from './workspace/pages/OvertimePage';
import SwapBoardPage from './workspace/pages/SwapBoardPage';
import PayrollPage from './workspace/pages/PayrollPage';
import TrainingPage from './workspace/pages/TrainingPage';
import AssetsPage from './workspace/pages/AssetsPage';
import EmployeeDashboardPage from './workspace/pages/EmployeeDashboardPage';

// L1 Owner (or legacy null-level) is all-on — consistent with the backend
// requireWorkforce bypass and every other gate in the codebase (Iron Rule 2).
const ALL_WORKFORCE_PERMS = [
  'workforce.employees.view', 'workforce.employees.create',
  'workforce.employees.edit', 'workforce.employees.delete',
  'workforce.leave.view', 'workforce.leave.create',
  'workforce.leave.edit', 'workforce.leave.delete',
  'workforce.payroll.view', 'workforce.payroll.create',
  'workforce.payroll.edit', 'workforce.payroll.delete',
  'workforce.assets.view', 'workforce.assets.create',
  'workforce.assets.edit', 'workforce.assets.delete',
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

export function WorkforceLeaveMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('workforce.leave.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <LeaveRequestsPage slug={slug} perms={perms} />;
}

export function WorkforcePunchingMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('workforce.employees.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <SmartPunchingPage slug={slug} perms={perms} />;
}

export function WorkforceOvertimeMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('workforce.employees.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <OvertimePage slug={slug} perms={perms} />;
}

export function WorkforceSwapMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('workforce.employees.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <SwapBoardPage slug={slug} perms={perms} />;
}

export function WorkforcePayrollMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('workforce.payroll.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <PayrollPage slug={slug} perms={perms} />;
}

export function WorkforceTrainingMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('workforce.employees.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <TrainingPage slug={slug} perms={perms} />;
}

export function WorkforceAssetsMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('workforce.assets.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <AssetsPage slug={slug} perms={perms} />;
}

export function WorkforceEmployeeDashboardMount() {
  const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
  if (loading) return null;
  if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
  if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
  if (!perms.has('workforce.employees.view')) return <Navigate to={`/c/${slug}`} replace />;
  return <EmployeeDashboardPage slug={slug} perms={perms} />;
}
