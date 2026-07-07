import { useState } from 'react';
import OrgChartTab from './OrgChartTab';
import DashboardTab from './DashboardTab';
import OnboardingTab from './OnboardingTab';
import OffboardingTab from './OffboardingTab';
import '../hr.css';

type Tab = 'dashboard' | 'org' | 'onboarding' | 'offboarding';
const TABS: { key: Tab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'org', label: 'Org Chart' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'offboarding', label: 'Offboarding' },
];

export default function HrPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const [tab, setTab] = useState<Tab>('dashboard');
  return (
    <div className="hr-page">
      <header className="hr-head"><h1>Human Resources</h1></header>
      <nav className="hr-tabs" role="tablist" aria-label="HR sections">
        {TABS.map((t) => (
          <button
            key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={`hr-tab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >{t.label}</button>
        ))}
      </nav>
      <div className="hr-tabpanel" role="tabpanel">
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'org' && <OrgChartTab slug={slug} />}
        {tab === 'onboarding' && <OnboardingTab perms={perms} />}
        {tab === 'offboarding' && <OffboardingTab perms={perms} />}
      </div>
    </div>
  );
}
