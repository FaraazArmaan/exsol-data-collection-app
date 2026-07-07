import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';
import { PRIORITIES, type KanbanOrder, type Priority, type ProductionStatus } from '../../shared/types';

interface Props {
  perms: ReadonlySet<string>;
}

const LANES: { key: ProductionStatus; label: string }[] = [
  { key: 'planned', label: 'Planned' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
  { key: 'cancelled', label: 'Cancelled' },
];

// Legal FSM transitions — mirror of the server LEGAL map in order-advance.ts.
const LEGAL: Record<ProductionStatus, ProductionStatus[]> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

// Drag board over the production-order FSM. Dragging a card to a legal lane advances
// it (completion consumes/produces stock server-side); status buttons are the
// touch/a11y fallback so the board is usable on mobile where native DnD is flaky.
export default function KanbanTab({ perms }: Props) {
  const [orders, setOrders] = useState<KanbanOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const canEdit = perms.has('manufacturing.products.edit');

  const load = useCallback(() => {
    setError(null);
    manufacturingApi.kanban()
      .then((r) => setOrders(r.items))
      .catch((e) => { setOrders([]); setError(e instanceof ManufacturingApiError ? e.code : String(e)); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const advance = async (id: string, to: ProductionStatus) => {
    setError(null);
    try {
      await manufacturingApi.advanceOrder(id, to);
      load();
    } catch (e) {
      if (e instanceof ManufacturingApiError && e.code === 'insufficient_stock') {
        const sf = (e.detail as { error?: { details?: { shortfalls?: Array<{ name: string; need: number; have: number }> } } })?.error?.details?.shortfalls ?? [];
        setError(sf.length ? `Insufficient stock: ${sf.map((s) => `${s.name} (need ${s.need}, have ${s.have})`).join(', ')}` : 'Insufficient component stock.');
      } else if (e instanceof ManufacturingApiError && e.code === 'illegal_transition') {
        setError('That move is not allowed by the production flow.');
      } else {
        setError(e instanceof ManufacturingApiError ? e.code : String(e));
      }
    }
  };

  const setPriority = async (id: string, priority: Priority) => {
    // optimistic
    setOrders((prev) => prev?.map((o) => (o.id === id ? { ...o, priority } : o)) ?? prev);
    try { await manufacturingApi.setOrderBoard({ id, priority }); }
    catch (e) { setError(e instanceof ManufacturingApiError ? e.code : String(e)); load(); }
  };

  const onDrop = (lane: ProductionStatus) => (e: DragEvent) => {
    e.preventDefault();
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const order = orders?.find((o) => o.id === id);
    if (!order || order.status === lane) return;
    if (!LEGAL[order.status].includes(lane)) {
      setError('That move is not allowed by the production flow.');
      return;
    }
    void advance(id, lane);
  };

  if (orders === null) return <p className="mfg-empty">Loading…</p>;

  return (
    <div>
      {error && (
        <div className="mfg-shortfall" role="alert">
          {error} <button type="button" className="mfg-btn" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}
      {orders.length === 0 ? (
        <div className="mfg-empty">No production orders yet. Create one from the Orders tab.</div>
      ) : (
        <div className="mfg-board">
          {LANES.map((lane) => {
            const cards = orders.filter((o) => o.status === lane.key);
            return (
              <div
                key={lane.key}
                className="mfg-lane"
                onDragOver={(e) => { if (canEdit) e.preventDefault(); }}
                onDrop={canEdit ? onDrop(lane.key) : undefined}
              >
                <div className="mfg-lane-head">
                  <span className={`mfg-badge ${lane.key}`}>{lane.label}</span>
                  <span className="mfg-lane-count">{cards.length}</span>
                </div>
                {cards.length === 0 ? (
                  <p className="mfg-lane-empty">—</p>
                ) : cards.map((o) => (
                  <div
                    key={o.id}
                    className={`mfg-card mfg-prio-${o.priority}`}
                    draggable={canEdit}
                    onDragStart={() => setDragId(o.id)}
                    onDragEnd={() => setDragId(null)}
                  >
                    <div className="mfg-card-title">{o.output_product_name}</div>
                    <div className="mfg-card-meta">
                      <span>×{o.qty}</span>
                      {o.due_on && <span className="mfg-card-due">due {o.due_on}</span>}
                    </div>
                    {canEdit && (
                      <div className="mfg-card-actions">
                        <select
                          className="mfg-prio-select"
                          value={o.priority}
                          aria-label="Priority"
                          onChange={(e) => void setPriority(o.id, e.target.value as Priority)}
                        >
                          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                        {LEGAL[o.status].map((to) => (
                          <button key={to} type="button" className="mfg-btn mfg-btn-sm" onClick={() => void advance(o.id, to)}>
                            {to === 'in_progress' ? 'Start' : to === 'done' ? 'Complete' : 'Cancel'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
