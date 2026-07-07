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

  return (
    <div className="sc-dashboard">
      <header className="sc-header">
        <h1>Supply Chain</h1>
        <p className="sc-sub">Live view across inventory, procurement, and production.</p>
      </header>
      {sections.length === 0 && (
        <div className="sc-state sc-empty sc-empty-all">
          Inventory, Procurement, and Manufacturing panels are hidden — enable those modules to
          see their data here. Supply chain tools (Suppliers, Risk, CO₂, Brief) are available
          below regardless.
        </div>
      )}
      {sections.length > 0 && (
        <div className="sc-sections">
          {sections.map((key) => {
            const Cmp = SECTION_COMPONENT[key];
            return <Cmp key={key} />;
          })}
        </div>
      )}
      {/* product_suppliers is supply-chain-native; show whenever the dashboard renders */}
      <SuppliersSection />
      <RiskSection />
      <Co2Section />
      <BriefSection />
    </div>
  );
}
