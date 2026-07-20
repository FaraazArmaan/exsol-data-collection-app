import { Link } from 'react-router-dom';
import type { Product } from '../../shared/types';
import { imagesApi } from '../../shared/api';
import { useProductsScope } from '../../shared/scope';

function formatPrice(cents: number, unit: string | null, type: Product['type']): string {
  const usd = `$${(cents / 100).toFixed(2)}`;
  return type === 'service' && unit ? `${usd} / ${unit}` : usd;
}

export function ProductTable(props: {
  items: Product[];
  selected: Set<string>;
  basePath: string;
  canEdit: boolean;
  canDelete: boolean;
  startIndex: number;
  categoriesById: Map<string, string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const {
    items, selected, basePath, canEdit, canDelete, startIndex, categoriesById,
    onToggleSelect, onToggleAll, onEdit, onDelete,
  } = props;
  const { queryParam: clientQuery } = useProductsScope();

  const allSelected = items.length > 0 && items.every((p) => selected.has(p.id));

  return (
    <table className="pm-table">
      <colgroup>
        <col style={{ width: 36 }} />
        <col style={{ width: 44 }} />
        <col style={{ width: 64 }} />
        <col />
        <col style={{ width: 120 }} />
        <col style={{ width: 140 }} />
        <col style={{ width: 110 }} />
        <col style={{ width: 100 }} />
        <col style={{ width: 70 }} />
        <col style={{ width: 90 }} />
        <col style={{ width: 100 }} />
        <col style={{ width: 80 }} />
      </colgroup>
      <thead>
        <tr>
          <th>
            <input
              type="checkbox"
              aria-label="Select all visible"
              checked={allSelected}
              onChange={onToggleAll}
              disabled={items.length === 0}
            />
          </th>
          <th>#</th>
          <th>Image</th>
          <th>Name</th>
          <th>SKU</th>
          <th>Category</th>
          <th>Brand</th>
          <th>Price</th>
          <th>Available</th>
          <th>Status</th>
          <th>Created</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {items.map((p, i) => (
          <tr key={p.id} className={selected.has(p.id) ? 'pm-row-selected' : undefined}>
            <td>
              <input
                type="checkbox"
                aria-label={`Select ${p.name}`}
                checked={selected.has(p.id)}
                onChange={() => onToggleSelect(p.id)}
              />
            </td>
            <td>{startIndex + i + 1}</td>
            <td>
              {p.hero_image_id
                ? <img
                    className="pm-thumb"
                    src={imagesApi.thumbUrl(p.hero_image_id, { clientId: clientQuery })}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                : <div className="pm-thumb pm-thumb-empty" aria-hidden />
              }
            </td>
            <td>
              <Link to={`${basePath}/${p.id}/edit`} className="pm-row-name">{p.name}</Link>
              <div className="pm-row-meta">
                {p.type === 'service' && <span className="pm-chip pm-chip-service">Service</span>}
                {p.tags.length > 0 && <span className="pm-chip">+ {p.tags.length} tags</span>}
              </div>
            </td>
            <td>{p.sku ?? '—'}</td>
            <td>{p.category_id ? (categoriesById.get(p.category_id) ?? '—') : '—'}</td>
            <td>{p.brand ?? '—'}</td>
            <td>{formatPrice(p.price_cents, p.unit, p.type)}</td>
            <td>{p.type === 'service' ? '—' : (p.inventory_enabled ? (p.inventory_qty_available == null ? 'Not tracked' : p.inventory_qty_available) : (p.stock_qty ?? 0))}</td>
            <td><span className={`pm-status pm-status-${p.status}`}>{p.status}</span></td>
            <td className="pm-muted">{p.created_at.slice(0, 10)}</td>
            <td className="pm-ops">
              {canEdit && (
                <button type="button" aria-label={`Edit ${p.name}`} onClick={() => onEdit(p.id)}>
                  ✎
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="pm-danger"
                  aria-label={`Archive ${p.name}`}
                  onClick={() => onDelete(p.id)}
                >
                  🗑
                </button>
              )}
            </td>
          </tr>
        ))}
        {items.length === 0 && (
          <tr>
            <td colSpan={12} className="pm-empty">No products match these filters.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
