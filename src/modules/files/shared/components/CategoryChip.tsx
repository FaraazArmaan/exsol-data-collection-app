import type { CategoryKey } from '../categories';
import { CATEGORY_LABELS } from '../categories';

const COLORS: Record<CategoryKey, string> = {
  finance_accounting:        '#2c5f2d',
  hr_payroll:                '#603f8b',
  legal_compliance:          '#7a3035',
  sales_crm:                 '#c08a1f',
  marketing_brand:           '#1f6a8a',
  product_catalog:           '#3a3a8a',
  procurement_supply_chain:  '#5a4329',
  operations_warehouse:      '#3a5a3a',
  manufacturing:             '#5a3a3a',
  customer_service:          '#3a5a5a',
  project_workflow:          '#5a5a3a',
};

interface Props {
  category: CategoryKey;
  onRemove?: () => void;
}

export function CategoryChip({ category, onRemove }: Props) {
  return (
    <span
      style={{
        background: COLORS[category],
        color: '#fff',
        padding: '4px 10px',
        borderRadius: 12,
        fontSize: 11,
        display: 'inline-flex',
        gap: 6,
        alignItems: 'center',
      }}
    >
      {CATEGORY_LABELS[category]}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', padding: 0 }}
          aria-label={`Remove ${CATEGORY_LABELS[category]}`}
        >×</button>
      )}
    </span>
  );
}
