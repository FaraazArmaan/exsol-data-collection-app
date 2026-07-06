import { useState, type FormEvent } from 'react';
import { warehouseApi } from '../../shared/api';
import { LOCATION_KINDS, KIND_LABEL, type LocationKind, type WarehouseLocation } from '../../shared/types';

interface Props {
  mode: 'create' | 'edit';
  location?: WarehouseLocation;
  onClose: () => void;
  onSaved: () => void;
}

// Create/edit a location. Name is required; kind picks from the fixed set. The
// parent already gated this behind the create/edit permission.
export function LocationModal({ mode, location, onClose, onSaved }: Props) {
  const [name, setName] = useState(location?.name ?? '');
  const [kind, setKind] = useState<LocationKind>(location?.kind ?? 'warehouse');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        await warehouseApi.createLocation({ name: name.trim(), kind });
      } else if (location) {
        await warehouseApi.updateLocation(location.id, { name: name.trim(), kind });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="wh-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wh-modal" role="dialog" aria-modal="true" aria-label={mode === 'create' ? 'New location' : 'Edit location'}>
        <h2 className="wh-modal-title">{mode === 'create' ? 'New location' : 'Edit location'}</h2>
        <form onSubmit={submit}>
          <label className="wh-field">
            <span>Name</span>
            <input
              className="wh-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Warehouse"
              autoFocus
            />
          </label>
          <label className="wh-field">
            <span>Kind</span>
            <select className="wh-input" value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
              {LOCATION_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </label>
          {error && <p className="wh-error" role="alert">{error}</p>}
          <div className="wh-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
              {busy ? 'Saving…' : mode === 'create' ? 'Create location' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
