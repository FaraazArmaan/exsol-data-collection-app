// src/modules/ams/components/ClientProductsSection.tsx
//
// Shown on the Admin's view of a Client. Lists every Product available in
// the registry; checked = enabled for this Client. PUT replaces the whole
// set, so changes are atomic and clients can't end up in a half-saved
// state if the user closes the browser mid-edit.

import { useEffect, useMemo, useState } from 'react';
import {
  getAdminClientProducts, putAdminClientProducts,
  type ProductAvailable,
} from '../api';

interface Props { clientId: string }

export function ClientProductsSection({ clientId }: Props) {
  const [available, setAvailable] = useState<ProductAvailable[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      const r = await getAdminClientProducts(clientId);
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) { setError(`Failed (${r.error.code})`); return; }
      setAvailable(r.data.available);
      setEnabled(new Set(r.data.enabled_keys));
      setSavedKeys(new Set(r.data.enabled_keys));
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  function toggle(key: string) {
    const next = new Set(enabled);
    if (next.has(key)) next.delete(key); else next.add(key);
    setEnabled(next);
  }

  async function save() {
    setSaving(true); setError(null);
    const r = await putAdminClientProducts(clientId, Array.from(enabled));
    setSaving(false);
    if (!r.ok) { setError(`Save failed (${r.error.code})`); return; }
    setSavedKeys(new Set(enabled));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter((p) => `${p.label} ${p.key}`.toLowerCase().includes(q));
  }, [available, query]);

  const dirty = available.some((p) => enabled.has(p.key) !== savedKeys.has(p.key));
  const enabledCount = enabled.size;

  if (loading) return <p className="muted">Loading Products…</p>;

  return (
    <section className="product-access-panel">
      <header className="product-access-panel__header">
        <div>
          <p className="admin-entry__eyebrow">Entitlements</p>
          <h3>Products</h3>
          <p className="muted">{enabledCount} of {available.length} enabled</p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products"
          aria-label="Search products"
          className="product-access-panel__search"
        />
      </header>
      {error && <p className="error">{error}</p>}
      <div className="product-access-panel__grid">
        {filtered.map((p) => {
          const isEnabled = enabled.has(p.key);
          return (
            <button
              key={p.key}
              type="button"
              className={`product-access-card${isEnabled ? ' is-enabled' : ''}`}
              onClick={() => toggle(p.key)}
              disabled={saving}
              aria-pressed={isEnabled}
            >
              <span>
                <span className="product-access-card__label">{p.label}</span>
                <span className="product-access-card__key">{p.key}</span>
              </span>
              <span className="toggle" aria-hidden aria-checked={isEnabled}>
                <span className="toggle-label toggle-label-off">OFF</span>
                <span className="toggle-label toggle-label-on">ON</span>
                <span className="toggle-knob" />
              </span>
            </button>
          );
        })}
      </div>
      <footer className="product-access-panel__footer">
        <span className="muted">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <div className="product-access-panel__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setEnabled(new Set(savedKeys))}
            disabled={saving || !dirty}
          >
            Reset
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </footer>
    </section>
  );
}
