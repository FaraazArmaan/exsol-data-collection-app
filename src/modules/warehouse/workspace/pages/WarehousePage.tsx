import { useState, type ReactNode } from 'react';
import OverviewTab from '../tabs/OverviewTab';
import PutawayTab from '../tabs/PutawayTab';
import InboundTab from '../tabs/InboundTab';
import SafetyTab from '../tabs/SafetyTab';
import AiSlottingTab from '../tabs/AiSlottingTab';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

interface TabDef {
  key: string;
  label: string;
  visible: boolean;
  render: () => ReactNode;
}

// Warehouse shell: a tabbed workspace over the v1 stock/locations flow plus the
// depth features (putaway, inbound, safety, AI slotting). Tabs are gated by the
// same bucket×verb perms as their endpoints; the mount already required
// warehouse.business.view so the Overview tab is always present.
export default function WarehousePage({ perms }: Props) {
  const canViewStock = perms.has('warehouse.products.view');
  const canViewSafety = perms.has('warehouse.business.view');

  const tabs: TabDef[] = [
    { key: 'overview', label: 'Stock & Locations', visible: true, render: () => <OverviewTab perms={perms} /> },
    { key: 'putaway', label: 'Putaway', visible: canViewStock, render: () => <PutawayTab perms={perms} /> },
    { key: 'inbound', label: 'Inbound', visible: canViewStock, render: () => <InboundTab perms={perms} /> },
    { key: 'safety', label: 'Safety', visible: canViewSafety, render: () => <SafetyTab perms={perms} /> },
    { key: 'ai', label: 'AI Slotting', visible: canViewStock, render: () => <AiSlottingTab perms={perms} /> },
  ].filter((t) => t.visible);

  const [active, setActive] = useState(tabs[0]!.key);
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0]!;

  return (
    <div className="wh-shell">
      <div className="wh-header">
        <div>
          <h1 className="wh-title">Warehouse</h1>
          <p className="wh-muted">Locations, stock, putaway and inbound operations.</p>
        </div>
      </div>

      <div className="wh-tabs" role="tablist" aria-label="Warehouse sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`wh-tab${active === t.key ? ' wh-tab-active' : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="wh-tabpanel">{activeTab.render()}</div>
    </div>
  );
}
