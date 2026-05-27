import { useState, type FormEvent } from 'react';
import { createClient } from '../api';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function AddClientModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    setSubmitting(true);
    setError(null);
    const r = await createClient(name.trim());
    setSubmitting(false);
    if (!r.ok) { setError(`Failed to create client (${r.error.code}).`); return; }
    onCreated();
    onClose();
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 90vw)' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>New Client</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          You'll configure roles, levels, and access structure on the next page.
        </p>
        <form onSubmit={handleSubmit}>
          <label>Name
            <input type="text" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Joe's Hardware" />
          </label>
          {error && <p className="error">{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
