import { useRef } from 'react';
import type { ProductFilters, ProductType, ProductCategory } from '../../shared/types';

export type ExportFormat = 'csv' | 'xlsx' | 'meta' | 'whatsapp' | 'amazon' | 'flipkart';

export function ProductFiltersBar(props: {
  filters: ProductFilters;
  categories: ProductCategory[];
  canEdit: boolean;
  canCreate: boolean;
  onChange: (next: Partial<ProductFilters>) => void;
  onExport: (format: ExportFormat) => void;
  onImport: () => void;
  onAdd: () => void;
}) {
  const { filters, categories, canEdit, canCreate, onChange, onExport, onImport, onAdd } = props;
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function handleExport(format: ExportFormat) {
    onExport(format);
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <div className="pm-filters">
      <select
        aria-label="Type"
        value={filters.type ?? ''}
        onChange={(e) => onChange({ type: (e.target.value || undefined) as ProductType | undefined })}
      >
        <option value="">Type — any</option>
        <option value="physical">Physical</option>
        <option value="service">Service</option>
      </select>

      <select
        aria-label="Category"
        value={filters.category_id ?? ''}
        onChange={(e) => onChange({ category_id: e.target.value || undefined })}
      >
        <option value="">Category — any</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <input
        aria-label="Brand"
        placeholder="Brand"
        value={filters.brand ?? ''}
        onChange={(e) => onChange({ brand: e.target.value || undefined })}
      />

      <input
        className="pm-search"
        aria-label="Search products"
        placeholder="🔍  Search name, SKU, brand…"
        value={filters.q ?? ''}
        onChange={(e) => onChange({ q: e.target.value || undefined })}
      />

      <div className="pm-filters-actions">
        <details ref={detailsRef} className="pm-export-menu">
          <summary>↓ Export ▾</summary>
          <ul role="menu">
            <li><button type="button" onClick={() => handleExport('csv')}>Generic CSV</button></li>
            <li><button type="button" onClick={() => handleExport('xlsx')}>Generic XLSX</button></li>
            <li><button type="button" onClick={() => handleExport('meta')}>Meta / Facebook Catalog</button></li>
            <li><button type="button" onClick={() => handleExport('whatsapp')}>WhatsApp Business</button></li>
            <li><button type="button" onClick={() => handleExport('amazon')}>Amazon Inventory Loader</button></li>
            <li><button type="button" onClick={() => handleExport('flipkart')}>Flipkart Catalog</button></li>
          </ul>
        </details>
        {canCreate && <button type="button" onClick={onImport}>↑ Import</button>}
        {canEdit && (
          <button type="button" className="pm-primary" onClick={onAdd}>+ Add Product</button>
        )}
      </div>
    </div>
  );
}
