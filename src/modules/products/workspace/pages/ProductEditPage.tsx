import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { productsApi, categoriesApi } from '../../shared/api';
import type {
  ProductCategory, ProductStatus, ProductWithImages,
} from '../../shared/types';
import {
  canCreateProducts, canEditProducts, canViewProducts,
} from '../../shared/permissions';
import { useUserAuth } from '../../../user-portal/user-auth-context';
import { ProductForm, emptyDraft, type ProductDraft } from '../components/ProductForm';

export default function ProductEditPage() {
  const params = useParams<{ slug: string; productId?: string }>();
  const nav = useNavigate();
  const mode: 'create' | 'edit' = params.productId ? 'edit' : 'create';
  const basePath = `/c/${params.slug}/products`;
  const { user, permissions, loading } = useUserAuth();

  const [draft, setDraft]   = useState<ProductDraft>(emptyDraft());
  const [loaded, setLoaded] = useState<ProductWithImages | null>(null);
  const [cats, setCats]     = useState<ProductCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const reloadProduct = useCallback(async () => {
    if (!params.productId) return;
    const p = await productsApi.get(params.productId);
    setLoaded(p);
    setDraft({
      type: p.type,
      name: p.name,
      description: p.description,
      category_id: p.category_id,
      brand: p.brand,
      tags: p.tags,
      price_cents: p.price_cents,
      sku: p.sku,
      stock_qty: p.stock_qty,
      unit: p.unit,
      status: p.status,
      hero_image_key: p.hero_image_key,
    });
  }, [params.productId]);

  useEffect(() => {
    categoriesApi.list().then((c) => setCats(c.items)).catch(() => {/* non-fatal */});
    if (mode === 'edit') {
      reloadProduct().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
  }, [mode, reloadProduct]);

  if (loading) return <p className="pm-shell pm-muted">Loading…</p>;
  if (!user) return <p className="pm-shell pm-muted">Sign in to edit products.</p>;
  if (!canViewProducts(permissions, user.level_number)) {
    return <p className="pm-shell pm-muted">You don't have access to Products.</p>;
  }

  const levelNumber = user.level_number;
  const canCreate = canCreateProducts(permissions, levelNumber);
  const canEdit   = canEditProducts(permissions, levelNumber);
  const writeAllowed = mode === 'create' ? canCreate : canEdit;

  async function save(targetStatus?: ProductStatus) {
    if (!writeAllowed) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<ProductDraft> = { ...draft, ...(targetStatus ? { status: targetStatus } : {}) };
      if (mode === 'create') {
        const saved = await productsApi.create(payload);
        nav(`${basePath}/${saved.id}/edit`, { replace: true });
      } else {
        await productsApi.update(params.productId!, payload);
        await reloadProduct();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const title = mode === 'create'
    ? 'New Product'
    : (draft.name || loaded?.name || 'Edit Product');

  return (
    <div className="pm-shell">
      <div className="pm-edit-header">
        <button type="button" onClick={() => nav(basePath)}>← Back</button>
        <h1>{title}</h1>
        {writeAllowed && (
          <>
            <button type="button" disabled={saving} onClick={() => save('draft')}>
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button
              type="button"
              className="pm-primary"
              disabled={saving || !draft.name.trim()}
              onClick={() => save('active')}
            >
              {saving ? 'Saving…' : 'Publish'}
            </button>
          </>
        )}
      </div>

      {error && <div className="pm-error" role="alert">{error}</div>}

      <ProductForm
        draft={draft}
        loaded={loaded}
        categories={cats}
        onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
        onReloadImages={reloadProduct}
      />
    </div>
  );
}
