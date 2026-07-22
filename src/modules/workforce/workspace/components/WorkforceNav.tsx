import { Link } from 'react-router-dom';
import { WorkspaceLayoutControl, orderedWorkspaceItems, useWorkspaceLayout } from '../../../../components/ui/WorkspaceLayout';

// Single source of truth for the workforce sub-nav. Every workforce page renders
// <WorkforceNav slug active="…" /> so the v1 pages (Staff & Schedule, Timesheets,
// Projects) and the depth pages (Leave … Employees) all show the same 11 tabs —
// previously each page inlined its own list, so the v1 pages only linked 3 of them
// and the depth features were undiscoverable from the landing page.
const TABS = [
  { key: 'schedule', label: 'Staff & Schedule', path: '' },
  { key: 'timesheets', label: 'Timesheets', path: '/timesheets' },
  { key: 'leave', label: 'Leave', path: '/leave' },
  { key: 'punching', label: 'Attendance', path: '/punching' },
  { key: 'overtime', label: 'Overtime', path: '/overtime' },
  { key: 'swaps', label: 'Swaps', path: '/swaps' },
  { key: 'payroll', label: 'Payroll', path: '/payroll' },
  { key: 'training', label: 'Training', path: '/training' },
  { key: 'assets', label: 'Assets', path: '/assets' },
  { key: 'employees', label: 'Employees', path: '/employees' },
  { key: 'projects', label: 'Projects', path: '/projects' },
] as const;

export type WorkforceTab = (typeof TABS)[number]['key'];

export function WorkforceNav({ slug, active }: { slug: string; active: WorkforceTab }) {
  const workspaceLayout = useWorkspaceLayout({
    namespace: 'workforce.tabs',
    tabs: TABS.map((tab) => ({ id: tab.key, label: tab.label })),
  });
  const tabs = orderedWorkspaceItems(TABS.map((tab) => ({ ...tab, id: tab.key })), workspaceLayout.effective.tabs);
  return (
    <div className="wf-tabs-toolbar">
      <nav className="wf-tabs ui-scroll-x" aria-label="Workforce sections">
        {tabs.map((t) =>
          t.key === active ? (
            <span key={t.key} className="wf-tab-link wf-tab-active">{t.label}</span>
          ) : (
            <Link key={t.key} className="wf-tab-link" to={`/c/${slug}/workforce${t.path}`}>
              {t.label}
            </Link>
          ),
        )}
      </nav>
      <WorkspaceLayoutControl definition={{ namespace: 'workforce.tabs', tabs: TABS.map((tab) => ({ id: tab.key, label: tab.label })) }} layout={workspaceLayout} label="Arrange tabs" />
    </div>
  );
}
