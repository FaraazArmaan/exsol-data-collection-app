import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { categoriesApi } from '../../shared/api';
import type { ProductCategory } from '../../shared/types';
import { useProductsScope } from '../../shared/scope';
import {
  canCreateProducts, canDeleteProducts, canEditProducts, canManageCategories,
} from '../../shared/permissions';

export default function ProductCategoriesPage() {
  const { slug } = useParams<{ slug: string }>();
  const nav = useNavigate();
  const scope = useProductsScope();
  const { permissions, levelNumber, queryParam: clientQuery } = scope;
  const [items, setItems] = useState<ProductCategory[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await categoriesApi.list({ clientId: clientQuery });
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void load(); }, []);

  if (!canManageCategories(permissions, levelNumber)) {
    return <p className="pm-shell pm-muted">You don't have access to manage categories.</p>;
  }

  const canRename = canEditProducts(permissions, levelNumber);
  const canDelete = canDeleteProducts(permissions, levelNumber);
  const canAdd    = canCreateProducts(permissions, levelNumber);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await categoriesApi.create(trimmed, { clientId: clientQuery });
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, current: string) {
    if (!confirm(`Delete "${current}"? Products in this category will become uncategorized.`)) return;
    try {
      await categoriesApi.remove(id, { clientId: clientQuery });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function rename(id: string, current: string) {
    const next = prompt('Rename category:', current);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === current) return;
    try {
      await categoriesApi.update(id, { name: trimmed }, { clientId: clientQuery });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="pm-shell">
      <div className="pm-edit-header">
        <button type="button" onClick={() => nav(`/c/${slug}/products`)}>← Products</button>
        <h1>Categories</h1>
      </div>

      {error && <div className="pm-error" role="alert">{error}</div>}

      <ul className="pm-cat-list">
        {items.map((c) => (
          <li key={c.id}>
            <span>{c.name}</span>
            {canRename && (
              <button type="button" aria-label={`Rename ${c.name}`} onClick={() => rename(c.id, c.name)}>
                ✎
              </button>
            )}
            {canDelete && (
              <button type="button" aria-label={`Delete ${c.name}`} onClick={() => remove(c.id, c.name)}>
                🗑
              </button>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="pm-muted">No categories yet.</li>}
      </ul>

      {canAdd && (
        <div className="pm-cat-add">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category name…"
            maxLength={80}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
          />
          <button type="button" className="pm-primary" disabled={busy || !name.trim()} onClick={add}>
            + Add
          </button>
        </div>
      )}
    </div>
  );
}
