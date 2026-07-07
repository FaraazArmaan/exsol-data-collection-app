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

// Enable-gate THEN permission — same order as the backend and Sidebar
// (Iron Rule 2). Mirrors the local gate() factory used by booking/inventory/crm.
function gate(perm: string, render: (slug: string, perms: ReadonlySet<string>) => JSX.Element) {
  return function Mount() {
    const { user, client, perms, workforceEnabled, slug, loading } = useAuthBits();
    if (loading) return null;
    if (!user || !client) return <Navigate to={`/c/${slug}/login`} replace />;
    if (!workforceEnabled) return <Navigate to={`/c/${slug}`} replace />;
    if (!perms.has(perm)) return <Navigate to={`/c/${slug}`} replace />;
    return render(slug, perms);
  };
}

export const WorkforceMount = gate('workforce.employees.view', (slug, perms) => <WorkforcePage slug={slug} perms={perms} />);
export const WorkforceProjectsMount = gate('project-service.business.view', (slug, perms) => <ProjectsPage slug={slug} perms={perms} />);
export const WorkforceTimesheetsMount = gate('workforce.employees.view', (slug, perms) => <TimesheetsPage slug={slug} perms={perms} />);
export const WorkforceLeaveMount = gate('workforce.leave.view', (slug, perms) => <LeaveRequestsPage slug={slug} perms={perms} />);
export const WorkforcePunchingMount = gate('workforce.employees.view', (slug, perms) => <SmartPunchingPage slug={slug} perms={perms} />);
export const WorkforceOvertimeMount = gate('workforce.employees.view', (slug, perms) => <OvertimePage slug={slug} perms={perms} />);
export const WorkforceSwapMount = gate('workforce.employees.view', (slug, perms) => <SwapBoardPage slug={slug} perms={perms} />);
export const WorkforcePayrollMount = gate('workforce.payroll.view', (slug, perms) => <PayrollPage slug={slug} perms={perms} />);
export const WorkforceTrainingMount = gate('workforce.employees.view', (slug, perms) => <TrainingPage slug={slug} perms={perms} />);
export const WorkforceAssetsMount = gate('workforce.assets.view', (slug, perms) => <AssetsPage slug={slug} perms={perms} />);
export const WorkforceEmployeeDashboardMount = gate('workforce.employees.view', (slug, perms) => <EmployeeDashboardPage slug={slug} perms={perms} />);

// Kept explicit: needs the :projectId param, whose useParams call must run
// unconditionally BEFORE the early returns (rules-of-hooks).
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
