import { useUserAuth } from '../../user-portal/user-auth-context';
import { visibleSectionsFor } from '../gating';
import type { SectionKey } from '../shared/types';
import { InventorySection } from './InventorySection';
import { ProcurementSection } from './ProcurementSection';
import { ManufacturingSection } from './ManufacturingSection';
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

  return (
    <div className="sc-dashboard">
      <header className="sc-header">
        <h1>Supply Chain</h1>
        <p className="sc-sub">Live view across inventory, procurement, and production.</p>
      </header>
      {sections.length === 0 ? (
        <div className="sc-state sc-empty sc-empty-all">
          No supply-chain modules are enabled yet. Enable Inventory, Procurement, or
          Manufacturing to see data here.
        </div>
      ) : (
        <div className="sc-sections">
          {sections.map((key) => {
            const Cmp = SECTION_COMPONENT[key];
            return <Cmp key={key} />;
          })}
        </div>
      )}
    </div>
  );
}
