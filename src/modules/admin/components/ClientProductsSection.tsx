// src/modules/admin/components/ClientProductsSection.tsx
//
// Shown on the Admin's view of a Client. Lists every Product available in
// the registry; checked = enabled for this Client. PUT replaces the whole
// set, so changes are atomic and clients can't end up in a half-saved
// state if the user closes the browser mid-edit.

import { useEffect, useState } from 'react';
import {
  getAdminClientProducts, putAdminClientProducts,
  type ProductAvailable,
} from '../../ams/api';

interface Props { clientId: string }

export function ClientProductsSection({ clientId }: Props) {
  const [available, setAvailable] = useState<ProductAvailable[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }

  if (loading) return <p className="muted">Loading Products…</p>;

  return (
    <section style={{ marginTop: 24, padding: 16, border: '1px solid var(--border-subtle, #2a2a2a)', borderRadius: 6 }}>
      <h3 style={{ marginTop: 0 }}>Products</h3>
      <p className="muted" style={{ fontSize: 12 }}>
        Toggle which Products this Client has access to. Drives which Modules
        appear in their Access Level Dashboard.
      </p>
      {error && <p className="error">{error}</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {available.map((p) => (
          <li key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <input
              type="checkbox"
              id={`product-${p.key}`}
              checked={enabled.has(p.key)}
              onChange={() => toggle(p.key)}
              disabled={saving}
            />
            <label htmlFor={`product-${p.key}`} style={{ cursor: 'pointer' }}>
              {p.label} <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{p.key}</span>
            </label>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </section>
  );
}
