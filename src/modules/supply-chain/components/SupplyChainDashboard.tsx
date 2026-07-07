import { useState } from 'react';
import { useUserAuth } from '../../user-portal/user-auth-context';
import { visibleSectionsFor } from '../gating';
import type { SectionKey } from '../shared/types';
import { InventorySection } from './InventorySection';
import { ProcurementSection } from './ProcurementSection';
import { ManufacturingSection } from './ManufacturingSection';
import { SuppliersSection } from './SuppliersSection';
import { RiskSection } from './RiskSection';
import { Co2Section } from './Co2Section';
import { BriefSection } from './BriefSection';
import '../supply-chain.css';

const SECTION_COMPONENT: Record<SectionKey, () => JSX.Element> = {
  inventory: InventorySection,
  procurement: ProcurementSection,
  manufacturing: ManufacturingSection,
};

export function SupplyChainDashboard() {
  const { enabledModules } = useUserAuth();
  const enabledKeys = new Set(enabledModules.map((m) => m.key));
  const sections = visibleSectionsFor(enabledKeys);

  // Overview groups the cross-module live panels (Inventory / Procurement /
  // Manufacturing), which are gated on those modules being enabled. The
  // supply-chain-native tools each get their own tab so the page reads like the
  // other modules instead of one long scroll.
  const renderOverview = () => {
    if (sections.length === 0) {
      return (
        <div className="sc-state sc-empty sc-empty-all">
          Inventory, Procurement, and Manufacturing panels are hidden — enable those modules to
          see their data here. Supply-chain tools (Suppliers, Risk, CO₂, AI Brief) are available in
          the tabs above.
        </div>
      );
    }
    return (
      <div className="sc-sections">
        {sections.map((key) => {
          const Cmp = SECTION_COMPONENT[key];
          return <Cmp key={key} />;
        })}
      </div>
    );
  };

  const tabs = [
    { key: 'overview', label: 'Overview', render: renderOverview },
    { key: 'suppliers', label: 'Suppliers', render: () => <SuppliersSection /> },
    { key: 'risk', label: 'Risk', render: () => <RiskSection /> },
    { key: 'co2', label: 'CO₂', render: () => <Co2Section /> },
    { key: 'brief', label: 'AI Brief', render: () => <BriefSection /> },
  ];

  const [active, setActive] = useState('overview');
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0]!;

  return (
    <div className="sc-dashboard">
      <header className="sc-header">
        <h1>Supply Chain</h1>
        <p className="sc-sub">Live view across inventory, procurement, and production.</p>
      </header>

      <div className="sc-tabs" role="tablist" aria-label="Supply chain sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`sc-tab${active === t.key ? ' sc-tab-active' : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="sc-tabpanel">{activeTab.render()}</div>
    </div>
  );
}
