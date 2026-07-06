import { useState, type FormEvent } from 'react';
import { procurementApi } from '../../shared/api';
import type { Supplier } from '../../shared/types';

interface Props {
  existing: Supplier | null; // null = create
  onClose: () => void;
  onSaved: () => void;
}

// Create/edit a supplier. Name required; phone/email/notes optional.
export function SupplierModal({ existing, onClose, onSaved }: Props) {
  const [name, setName] = useState(existing?.name ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const payload = { name: name.trim(), phone, email, notes };
    try {
      if (existing) await procurementApi.updateSupplier(existing.id, payload);
      else await procurementApi.createSupplier(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="proc-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="proc-modal" role="dialog" aria-modal="true" aria-labelledby="proc-supplier-title">
        <div className="proc-modal-header">
          <h2 id="proc-supplier-title">{existing ? 'Edit supplier' : 'Add supplier'}</h2>
          <button type="button" className="proc-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <form className="proc-modal-body" onSubmit={submit}>
          <label className="proc-field">
            <span>Name <span className="proc-req">*</span></span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Supplier name" />
          </label>
          <label className="proc-field">
            <span>Phone</span>
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone" />
          </label>
          <label className="proc-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          </label>
          <label className="proc-field">
            <span>Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} aria-label="Notes" />
          </label>
          {error && <div className="proc-error" role="alert">{error}</div>}
          <div className="proc-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
              {busy ? 'Saving…' : existing ? 'Save changes' : 'Add supplier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
