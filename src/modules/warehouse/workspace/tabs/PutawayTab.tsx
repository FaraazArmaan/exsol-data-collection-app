import { useCallback, useEffect, useState } from 'react';
import { warehouseApi } from '../../shared/api';
import type { PutawayStatus, PutawayTask, WarehouseLocation } from '../../shared/types';
import { Button } from '../../../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../../../components/ui/Feedback';

interface Props {
  perms: ReadonlySet<string>;
}

// Putaway queue: goods received against a PO land here awaiting a home. Generate
// pulls tasks from received POs; each pending task is confirmed into a location.
export default function PutawayTab({ perms }: Props) {
  const [tasks, setTasks] = useState<PutawayTask[] | null>(null);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [status, setStatus] = useState<PutawayStatus>('pending');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmTask, setConfirmTask] = useState<PutawayTask | null>(null);

  const canEdit = perms.has('warehouse.products.edit');

  const load = useCallback((s: PutawayStatus) => {
    setError(null);
    warehouseApi.putawayList(s)
      .then((r) => setTasks(r.tasks))
      .catch((e) => { setTasks([]); setError(e instanceof Error ? e.message : String(e)); });
  }, []);

  useEffect(() => { load(status); }, [load, status]);
  useEffect(() => { warehouseApi.listLocations().then((r) => setLocations(r.locations)).catch(() => {}); }, []);

  const onGenerate = async () => {
    setError(null);
    setNotice(null);
    try {
      const r = await warehouseApi.putawayGenerate();
      setNotice(r.created > 0 ? `Enqueued ${r.created} task${r.created === 1 ? '' : 's'} from received POs.` : 'No new received-PO lines to enqueue.');
      load(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onConfirmed = () => {
    setConfirmTask(null);
    setTasks(null);
    load(status);
  };

  return (
    <div>
      <div className="wh-actions wh-actions-end">
        <div className="wh-segmented" role="tablist" aria-label="Putaway status">
          {(['pending', 'done'] as PutawayStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              className={`wh-segment${status === s ? ' wh-segment-active' : ''}`}
              onClick={() => { setTasks(null); setStatus(s); }}
            >
              {s === 'pending' ? 'Pending' : 'Done'}
            </button>
          ))}
        </div>
        {canEdit && (
          <button type="button" className="btn btn-secondary" onClick={onGenerate}>
            Generate from received POs
          </button>
        )}
      </div>

      {notice && <div className="wh-notice" role="status">{notice}</div>}
      {error && <ErrorState title="Putaway tasks could not load" action={<Button variant="secondary" onClick={() => load(status)}>Try again</Button>}>{error}</ErrorState>}

      {tasks === null ? (
        <LoadingState title="Loading putaway tasks" />
      ) : tasks.length === 0 ? (
        <EmptyState title={status === 'pending'
            ? 'No pending putaway tasks. Receive a purchase order in Procurement, then generate tasks.'
            : 'No completed putaway tasks yet.'} />
      ) : (
        <table className="wh-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>SKU</th>
              <th className="wh-num">Qty</th>
              <th>Source</th>
              {status === 'pending' ? <th /> : <th>Location</th>}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.product_name}</td>
                <td className="wh-muted">{t.sku ?? '—'}</td>
                <td className="wh-num">{t.qty}</td>
                <td className="wh-muted">{t.purchase_order_id ? 'Purchase order' : 'Manual'}</td>
                {status === 'pending' ? (
                  <td className="wh-num">
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={locations.length === 0}
                        title={locations.length === 0 ? 'Create a location first' : undefined}
                        onClick={() => setConfirmTask(t)}
                      >
                        Put away
                      </button>
                    )}
                  </td>
                ) : (
                  <td>{t.location_name ?? '—'}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirmTask && (
        <PutawayConfirmModal
          task={confirmTask}
          locations={locations}
          onClose={() => setConfirmTask(null)}
          onConfirmed={onConfirmed}
        />
      )}
    </div>
  );
}

function PutawayConfirmModal({
  task, locations, onClose, onConfirmed,
}: {
  task: PutawayTask;
  locations: WarehouseLocation[];
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [locationId, setLocationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!locationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await warehouseApi.putawayConfirm({ task_id: task.id, location_id: locationId });
      onConfirmed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="wh-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wh-modal" role="dialog" aria-modal="true" aria-label="Put away stock">
        <h2 className="wh-modal-title">Put away {task.qty} × {task.product_name}</h2>
        <label className="wh-field">
          <span>Destination location</span>
          <select className="wh-input" value={locationId} onChange={(e) => setLocationId(e.target.value)} autoFocus>
            <option value="">Select location…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        {error && <p className="wh-error" role="alert">{error}</p>}
        <div className="wh-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!locationId || busy} onClick={submit}>
            {busy ? 'Putting away…' : 'Confirm putaway'}
          </button>
        </div>
      </div>
    </div>
  );
}
