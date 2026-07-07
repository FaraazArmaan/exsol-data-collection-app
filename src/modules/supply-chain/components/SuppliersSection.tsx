import { useEffect, useState } from 'react';
import type { ProductWithSuppliers, ProductSupplierLink, CreateSupplierLinkBody, SuggestedAlternate } from '../shared/types';
import {
  fetchProductsWithSuppliers, fetchSupplierLinks,
  createSupplierLink, deleteSupplierLink,
} from '../shared/api';

interface AddFormState {
  productId: string;
  supplierId: string;
  leadTimeDays: string;
  unitCostCents: string;
  isPrimary: boolean;
}

const EMPTY_FORM: AddFormState = {
  productId: '',
  supplierId: '',
  leadTimeDays: '7',
  unitCostCents: '0',
  isPrimary: false,
};

export function SuppliersSection() {
  const [products, setProducts] = useState<ProductWithSuppliers[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [links, setLinks] = useState<ProductSupplierLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [suggestedAlternate, setSuggestedAlternate] = useState<SuggestedAlternate | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchProductsWithSuppliers()
      .then((r) => { if (alive) { setProducts(r.productsWithSuppliers ?? []); setLoading(false); } })
      .catch((e) => { if (alive) { setError(String(e?.message ?? e)); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  function selectProduct(productId: string) {
    setSelectedProductId(productId);
    setShowAdd(false);
    setSubmitError(null);
    setLinksLoading(true);
    setLinksError(null);
    setSuggestedAlternate(null);
    fetchSupplierLinks(productId)
      .then((r) => { setLinks(r.links ?? []); setSuggestedAlternate(r.suggestedAlternate ?? null); setLinksLoading(false); })
      .catch((e) => { setLinksError(String(e?.message ?? e)); setLinksLoading(false); });
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProductId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: CreateSupplierLinkBody = {
        productId: selectedProductId,
        supplierId: form.supplierId,
        leadTimeDays: Number(form.leadTimeDays),
        unitCostCents: Number(form.unitCostCents),
        isPrimary: form.isPrimary,
      };
      await createSupplierLink(body);
      setForm(EMPTY_FORM);
      setShowAdd(false);
      // Refresh links and product list.
      const [linksRes, prodRes] = await Promise.all([
        fetchSupplierLinks(selectedProductId),
        fetchProductsWithSuppliers(),
      ]);
      setLinks(linksRes.links ?? []);
      setSuggestedAlternate(linksRes.suggestedAlternate ?? null);
      setProducts(prodRes.productsWithSuppliers ?? []);
    } catch (e) {
      setSubmitError(String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(linkId: string) {
    try {
      await deleteSupplierLink(linkId);
      if (selectedProductId) {
        const [linksRes, prodRes] = await Promise.all([
          fetchSupplierLinks(selectedProductId),
          fetchProductsWithSuppliers(),
        ]);
        setLinks(linksRes.links ?? []);
        setSuggestedAlternate(linksRes.suggestedAlternate ?? null);
        setProducts(prodRes.productsWithSuppliers ?? []);
      }
    } catch (e) {
      setLinksError(String((e as Error)?.message ?? e));
    }
  }

  async function handleSetPrimary(link: ProductSupplierLink) {
    if (!selectedProductId) return;
    try {
      await createSupplierLink({
        productId: selectedProductId,
        supplierId: link.supplierId,
        leadTimeDays: link.leadTimeDays,
        unitCostCents: link.unitCostCents,
        isPrimary: true,
      });
      const linksRes = await fetchSupplierLinks(selectedProductId);
      setLinks(linksRes.links ?? []);
    } catch (e) {
      setLinksError(String((e as Error)?.message ?? e));
    }
  }

  return (
    <section className="sc-section">
      <h2 className="sc-section-title">Alternate Suppliers</h2>
      {loading && <div className="sc-state sc-loading">Loading…</div>}
      {!loading && error && (
        <div className="sc-state sc-error">Couldn't load supplier data (error {error}).</div>
      )}
      {!loading && !error && (
        <div className="sc-suppliers-layout">
          <div className="sc-suppliers-list">
            <p className="sc-note">Select a product to manage its suppliers.</p>
            {products.length === 0 ? (
              <div className="sc-state sc-empty">No products with suppliers yet.</div>
            ) : (
              <table className="sc-table">
                <thead>
                  <tr><th>Product</th><th>Suppliers</th><th>Primary</th></tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr
                      key={p.productId}
                      className={selectedProductId === p.productId ? 'sc-row-selected' : 'sc-row-clickable'}
                      onClick={() => selectProduct(p.productId)}
                    >
                      <td>{p.name}</td>
                      <td>{p.supplierCount}</td>
                      <td>{p.primarySupplier ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button className="sc-btn-secondary sc-mt8" onClick={() => { setSelectedProductId(null); setShowAdd(false); }}>
              + Link supplier to product
            </button>
            {!selectedProductId && showAdd && (
              <p className="sc-note">Select a product above first.</p>
            )}
          </div>

          {selectedProductId && (
            <div className="sc-suppliers-detail">
              <div className="sc-detail-header">
                <span className="sc-detail-title">
                  {products.find((p) => p.productId === selectedProductId)?.name ?? selectedProductId}
                </span>
                <button className="sc-btn-primary" onClick={() => { setShowAdd(true); setSubmitError(null); setForm(EMPTY_FORM); }}>
                  + Add supplier
                </button>
              </div>

              {suggestedAlternate && (
                <div className="sc-note sc-suggested-alt">
                  Suggested alternate: {suggestedAlternate.supplierName} ({suggestedAlternate.leadTimeDays} day lead)
                </div>
              )}
              {linksLoading && <div className="sc-state sc-loading">Loading suppliers…</div>}
              {!linksLoading && linksError && (
                <div className="sc-state sc-error">Error loading suppliers ({linksError}).</div>
              )}
              {!linksLoading && !linksError && links.length === 0 && (
                <div className="sc-state sc-empty">No suppliers linked yet.</div>
              )}
              {!linksLoading && !linksError && links.length > 0 && (
                <table className="sc-table sc-mt8">
                  <thead>
                    <tr><th>Supplier</th><th>Lead time</th><th>Unit cost</th><th>Primary</th><th></th></tr>
                  </thead>
                  <tbody>
                    {links.map((l) => (
                      <tr key={l.id}>
                        <td>{l.supplierName}</td>
                        <td>{l.leadTimeDays}d</td>
                        <td>${(l.unitCostCents / 100).toFixed(2)}</td>
                        <td>
                          {l.isPrimary ? (
                            <span className="sc-badge-primary">Primary</span>
                          ) : (
                            <button className="sc-btn-link" onClick={() => handleSetPrimary(l)}>
                              Set primary
                            </button>
                          )}
                        </td>
                        <td>
                          <button className="sc-btn-danger" onClick={() => handleDelete(l.id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {showAdd && (
                <form className="sc-add-form sc-mt8" onSubmit={handleAdd}>
                  <h3 className="sc-form-title">Add supplier link</h3>
                  <label className="sc-form-label">
                    Supplier ID
                    <input
                      className="sc-form-input"
                      value={form.supplierId}
                      onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
                      placeholder="uuid"
                      required
                    />
                  </label>
                  <label className="sc-form-label">
                    Lead time (days)
                    <input
                      className="sc-form-input"
                      type="number"
                      min={0}
                      value={form.leadTimeDays}
                      onChange={(e) => setForm((f) => ({ ...f, leadTimeDays: e.target.value }))}
                      required
                    />
                  </label>
                  <label className="sc-form-label">
                    Unit cost (cents)
                    <input
                      className="sc-form-input"
                      type="number"
                      min={0}
                      value={form.unitCostCents}
                      onChange={(e) => setForm((f) => ({ ...f, unitCostCents: e.target.value }))}
                      required
                    />
                  </label>
                  <label className="sc-form-check">
                    <input
                      type="checkbox"
                      checked={form.isPrimary}
                      onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))}
                    />
                    Set as primary supplier
                  </label>
                  {submitError && <div className="sc-state sc-error">Error: {submitError}</div>}
                  <div className="sc-form-actions">
                    <button type="submit" className="sc-btn-primary" disabled={submitting}>
                      {submitting ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" className="sc-btn-secondary" onClick={() => setShowAdd(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
