import type { ProductCategory, ProductStatus } from '../../shared/types';
import { CategoryCombobox } from './CategoryCombobox';

type Patch = Partial<{
  category_id: string | null;
  brand: string | null;
  tags: string[];
  status: ProductStatus;
}>;

export function ProductOrgSection(props: {
  category_id: string | null;
  brand: string | null;
  tags: string[];
  status: ProductStatus;
  categories: ProductCategory[];
  canManageCategories?: boolean;
  onCreateCategory?: (name: string) => Promise<ProductCategory>;
  onChange: (patch: Patch) => void;
}) {
  return (
    <div className="pm-section">
      <h3>Organization</h3>

      <label htmlFor="pm-cat">Category</label>
      <CategoryCombobox
        value={props.category_id}
        categories={props.categories}
        canCreate={(props.canManageCategories ?? false) && !!props.onCreateCategory}
        onSelect={(id) => props.onChange({ category_id: id })}
        onCreate={async (name) => props.onCreateCategory!(name)}
      />

      <label htmlFor="pm-brand">Brand</label>
      <input
        id="pm-brand"
        value={props.brand ?? ''}
        maxLength={120}
        onChange={(e) => props.onChange({ brand: e.target.value || null })}
      />

      <label htmlFor="pm-tags">Tags (comma separated)</label>
      <input
        id="pm-tags"
        value={props.tags.join(', ')}
        onChange={(e) => props.onChange({
          tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
        })}
      />

      <label htmlFor="pm-status">Status</label>
      <select
        id="pm-status"
        value={props.status}
        onChange={(e) => props.onChange({ status: e.target.value as ProductStatus })}
      >
        <option value="draft">Draft</option>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>
    </div>
  );
}
