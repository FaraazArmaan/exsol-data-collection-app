import { useCallback, useEffect, useState } from 'react';
import { manufacturingApi, ManufacturingApiError } from '../../shared/api';
import type { CapacitySlot, MfgResource, ProductionOrder } from '../../shared/types';

interface Props {
  perms: ReadonlySet<string>;
}

// Capacity Planning: work centers with a daily hours capacity, orders scheduled
// onto them (resource + estimated hours + due date), and a load view that flags
// overbooked resource-days (booked hours > capacity).
export default function CapacityTab({ perms }: Props) {
  const [resources, setResources] = useState<MfgResource[] | null>(null);
  const [slots, setSlots] = useState<CapacitySlot[]>([]);
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [hours, setHours] = useState('8');

  const [orderId, setOrderId] = useState('');
  const [assignRes, setAssignRes] = useState('');
  const [estHours, setEstHours] = useState('1');

  const canCreate = perms.has('manufacturing.business.create');
  const canSchedule = perms.has('manufacturing.products.edit');

  const load = useCallback(() => {
    setError(null);
    manufacturingApi.capacity()
      .then((r) => { setResources(r.resources); setSlots(r.slots); })
      .catch((e) => { setResources([]); setError(e instanceof ManufacturingApiError ? e.code : String(e)); });
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canSchedule) manufacturingApi.listOrders().then((r) => { setOrders(r.items); if (r.items[0]) setOrderId(r.items[0].id); }).catch(() => {}); }, [canSchedule]);

  const addResource = async () => {
    if (!name.trim()) { setError('Resource name is required.'); return; }
    setError(null);
    try {
      await manufacturingApi.addResource({ name: name.trim(), hours_per_day: Math.max(1, Number(hours) || 8) });
      setName(''); setHours('8'); load();
    } catch (e) {
      setError(e instanceof ManufacturingApiError && e.code === 'name_taken' ? 'A resource with that name already exists.' : (e instanceof ManufacturingApiError ? e.code : String(e)));
    }
  };

  const schedule = async () => {
    if (!orderId || !assignRes) { setError('Pick an order and a resource.'); return; }
    setError(null);
    try {
      await manufacturingApi.assignOrderResource({ order_id: orderId, resource_id: assignRes, estimated_hours: Math.max(0, Number(estHours) || 0) });
      setEstHours('1'); load();
    } catch (e) { setError(e instanceof ManufacturingApiError ? e.code : String(e)); }
  };

  if (resources === null) return <p className="mfg-empty">Loading…</p>;

  return (
    <div>
      {error && <div className="mfg-shortfall" role="alert">{error} <button type="button" className="mfg-btn" onClick={() => setError(null)}>dismiss</button></div>}

      <h4>Resources</h4>
      {canCreate && (
        <div className="mfg-lot-form">
          <input placeholder="Work center name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="number" min={1} style={{ width: 90 }} value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Hours per day" />
          <span className="mfg-muted">hrs/day</span>
          <button className="mfg-btn primary" onClick={() => void addResource()}>Add resource</button>
        </div>
      )}
      {resources.length === 0 ? <div className="mfg-empty">No resources yet. Add a work center to plan capacity.</div> : (
        <p className="mfg-muted">{resources.map((r) => `${r.name} (${r.hours_per_day}h/day)`).join(' · ')}</p>
      )}

      {canSchedule && resources.length > 0 && orders.length > 0 && (
        <>
          <h4 style={{ marginTop: 20 }}>Schedule an order</h4>
          <div className="mfg-lot-form">
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} aria-label="Order">
              {orders.map((o) => <option key={o.id} value={o.id}>{o.output_product_name} ×{o.qty}</option>)}
            </select>
            <select value={assignRes} onChange={(e) => setAssignRes(e.target.value)} aria-label="Resource">
              <option value="">— resource —</option>
              {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <input type="number" min={0} style={{ width: 70 }} value={estHours} onChange={(e) => setEstHours(e.target.value)} aria-label="Estimated hours" />
            <span className="mfg-muted">hrs</span>
            <button className="mfg-btn primary" onClick={() => void schedule()} disabled={!assignRes}>Assign</button>
          </div>
          <p className="mfg-muted" style={{ fontSize: '0.8rem' }}>Tip: set an order's due date on the Kanban tab so it appears on the load calendar.</p>
        </>
      )}

      <h4 style={{ marginTop: 20 }}>Load (next 14 days)</h4>
      {slots.length === 0 ? <div className="mfg-empty">No scheduled load. Assign orders with a due date to see the calendar.</div> : (
        <table className="mfg-table">
          <thead><tr><th>Resource</th><th>Day</th><th>Booked</th><th>Capacity</th><th>Status</th></tr></thead>
          <tbody>
            {slots.map((s) => (
              <tr key={`${s.resource_id}-${s.day}`} className={s.overbooked ? 'mfg-row-over' : ''}>
                <td>{s.resource_name}</td>
                <td className="mfg-muted">{s.day}</td>
                <td>{s.booked}h</td>
                <td>{s.capacity}h</td>
                <td>{s.overbooked ? <span className="mfg-qc mfg-qc-fail">Overbooked</span> : <span className="mfg-qc mfg-qc-pass">OK</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
