import type { ProductCategory, ProductStatus } from '../../shared/types';

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
  onChange: (patch: Patch) => void;
}) {
  return (
    <div className="pm-section">
      <h3>Organization</h3>

      <label htmlFor="pm-cat">Category</label>
      <select
        id="pm-cat"
        value={props.category_id ?? ''}
        onChange={(e) => props.onChange({ category_id: e.target.value || null })}
      >
        <option value="">— uncategorized —</option>
        {props.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

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
