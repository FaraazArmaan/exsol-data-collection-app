import { useCallback, useEffect, useState } from 'react';
import { procurementApi } from '../../shared/api';
import type { Supplier } from '../../shared/types';
import { ProcurementTabs } from '../ProcurementTabs';
import { SupplierModal } from '../components/SupplierModal';
import { SupplierContactsModal } from '../components/SupplierContactsModal';
import { SupplierPricesModal } from '../components/SupplierPricesModal';
import { Button } from '../../../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../../../components/ui/Feedback';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

// Suppliers CRUD. null=loading, []=empty, error banner — every state rendered.
export default function SuppliersPage({ perms }: Props) {
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [contactsTarget, setContactsTarget] = useState<Supplier | null>(null);
  const [pricesTarget, setPricesTarget] = useState<Supplier | null>(null);

  const canCreate = perms.has('procurement.products.create');
  const canEdit = perms.has('procurement.products.edit');
  const canDelete = perms.has('procurement.products.delete');

  const load = useCallback(() => {
    setError(null);
    procurementApi.listSuppliers()
      .then((r) => setRows(r.suppliers))
      .catch((e) => { setRows([]); setError(e instanceof Error ? e.message : String(e)); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSaved = () => { setCreating(false); setEditing(null); setRows(null); load(); };

  const remove = async (s: Supplier) => {
    setDeletingId(s.id);
    setError(null);
    try {
      await procurementApi.deleteSupplier(s.id);
      setRows(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="proc-shell">
      <div className="proc-header">
        <h1 className="proc-title">Procurement</h1>
        {canCreate && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>Add supplier</button>
        )}
      </div>
      <ProcurementTabs />

      {error && <ErrorState title="Suppliers could not load" action={<Button variant="secondary" onClick={load}>Try again</Button>}>{error}</ErrorState>}

      {rows === null ? (
        <LoadingState title="Loading suppliers" />
      ) : rows.length === 0 ? (
        <EmptyState title="No suppliers yet.">{canCreate ? 'Add your first supplier to start ordering.' : undefined}</EmptyState>
      ) : (
        <table className="proc-table">
          <thead>
            <tr>
              <th>Name</th><th>Phone</th><th>Email</th><th>Terms</th><th>Rating</th><th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="proc-muted">{s.phone ?? '—'}</td>
                <td className="proc-muted">{s.email ?? '—'}</td>
                <td className="proc-muted">{s.payment_terms ?? '—'}</td>
                <td>
                  {s.rating ? (
                    <span className="proc-rating" aria-label={`${s.rating} out of 5`}>{'★'.repeat(s.rating)}</span>
                  ) : (
                    <span className="proc-muted">—</span>
                  )}
                </td>
                <td className="proc-row-actions">
                  <button type="button" className="proc-link" onClick={() => setContactsTarget(s)}>Contacts</button>
                  <button type="button" className="proc-link" onClick={() => setPricesTarget(s)}>Prices</button>
                  {canEdit && <button type="button" className="proc-link" onClick={() => setEditing(s)}>Edit</button>}
                  {canDelete && (
                    <button type="button" className="proc-link proc-link-danger" disabled={deletingId === s.id} onClick={() => remove(s)}>
                      {deletingId === s.id ? 'Removing…' : 'Delete'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(creating || editing) && (
        <SupplierModal existing={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={onSaved} />
      )}
      {contactsTarget && (
        <SupplierContactsModal supplier={contactsTarget} canEdit={canEdit} onClose={() => setContactsTarget(null)} />
      )}
      {pricesTarget && (
        <SupplierPricesModal supplier={pricesTarget} canEdit={canEdit} onClose={() => setPricesTarget(null)} />
      )}
    </div>
  );
}
