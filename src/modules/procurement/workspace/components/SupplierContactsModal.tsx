import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { procurementApi } from '../../shared/api';
import type { Supplier, SupplierContact } from '../../shared/types';

interface Props {
  supplier: Supplier;
  canEdit: boolean;
  onClose: () => void;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Named contacts under a supplier: list + add + remove. Every state handled.
export function SupplierContactsModal({ supplier, canEdit, onClose }: Props) {
  const [contacts, setContacts] = useState<SupplierContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    procurementApi.listContacts(supplier.id)
      .then((r) => setContacts(r.contacts))
      .catch((e) => { setContacts([]); setError(msg(e)); });
  }, [supplier.id]);

  useEffect(() => { load(); }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await procurementApi.createContact({ supplier_id: supplier.id, name: name.trim(), role, phone, email });
      setName(''); setRole(''); setPhone(''); setEmail('');
      setContacts(null);
      load();
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await procurementApi.deleteContact(id);
      setContacts(null);
      load();
    } catch (err) {
      setError(msg(err));
    }
  };

  return (
    <div className="proc-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="proc-modal proc-modal-wide" role="dialog" aria-modal="true" aria-labelledby="proc-contacts-title">
        <div className="proc-modal-header">
          <h2 id="proc-contacts-title">Contacts — {supplier.name}</h2>
          <button type="button" className="proc-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="proc-modal-body">
          {error && <div className="proc-error" role="alert">{error}</div>}

          {contacts === null ? (
            <p className="proc-muted">Loading…</p>
          ) : contacts.length === 0 ? (
            <p className="proc-empty">No contacts yet.</p>
          ) : (
            <ul className="proc-contacts">
              {contacts.map((c) => (
                <li key={c.id} className="proc-contact">
                  <div>
                    <strong>{c.name}</strong>{c.role ? ` · ${c.role}` : ''}
                    <div className="proc-muted">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  {canEdit && (
                    <button type="button" className="proc-link proc-link-danger" onClick={() => remove(c.id)}>Remove</button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <form className="proc-contact-form" onSubmit={add}>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *" aria-label="Contact name" />
              <input type="text" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" aria-label="Contact role" />
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" aria-label="Contact phone" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Contact email" />
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                {busy ? 'Adding…' : 'Add contact'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
