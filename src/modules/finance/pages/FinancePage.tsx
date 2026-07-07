import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import '../finance.css';
import { currentMonth, monthLabel } from '../shared/format';
import { OverviewTab } from '../tabs/OverviewTab';
import { CashflowTab } from '../tabs/CashflowTab';
import { RecurringTab } from '../tabs/RecurringTab';
import { ApprovalsTab } from '../tabs/ApprovalsTab';
import { AiTab } from '../tabs/AiTab';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// Tab registry — each depth feature adds one entry. `tab` is persisted in the URL
// (?tab=) so views are deep-linkable and survive a refresh.
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'cashflow', label: 'Cashflow' },
  { key: 'recurring', label: 'Recurring' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'ai', label: 'AI Insights' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function FinancePage({ perms }: Props) {
  const [month, setMonth] = useState<string>(currentMonth());
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab');
  const activeTab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : 'overview';
  const setTab = (key: TabKey) => setSearchParams({ tab: key }, { replace: true });

  return (
    <div className="fin-shell">
      <header className="fin-header">
        <div>
          <h1 className="fin-title">Finance</h1>
          <p className="fin-subtitle">{monthLabel(month)}</p>
        </div>
        <label className="fin-month-picker">
          <span className="fin-muted">Month</span>
          <input
            type="month" value={month}
            max={currentMonth()}
            onChange={(e) => setMonth(e.target.value || currentMonth())}
          />
        </label>
      </header>

      <nav className="fin-tabs" role="tablist" aria-label="Finance views">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={`fin-tab ${activeTab === t.key ? 'fin-tab-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' && <OverviewTab month={month} perms={perms} />}
      {activeTab === 'cashflow' && <CashflowTab month={month} />}
      {activeTab === 'recurring' && <RecurringTab perms={perms} />}
      {activeTab === 'approvals' && <ApprovalsTab perms={perms} />}
      {activeTab === 'ai' && <AiTab month={month} perms={perms} />}
    </div>
  );
}
