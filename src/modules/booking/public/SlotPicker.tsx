import { useEffect, useState } from 'react';
import { bookingPublicApi, type PublicService, type PublicResource, type Slot } from '../api';
import { formatTime, isoDatePlus } from '../format';

interface Props {
  slug: string;
  service: PublicService;
  onPick: (slot: Slot) => void;
  onBack: () => void;
}

export function SlotPicker({ slug, service, onPick, onBack }: Props) {
  const [date, setDate] = useState<string>(isoDatePlus(0));
  const [resourceId, setResourceId] = useState<string>('any');
  const [resources, setResources] = useState<PublicResource[]>([]);
  const [slots, setSlots] = useState<Slot[] | null>(null);

  useEffect(() => {
    let cancel = false;
    bookingPublicApi.resources(slug).then((r) => { if (!cancel) setResources(r.resources); }).catch(() => { /* names optional */ });
    return () => { cancel = true; };
  }, [slug]);

  useEffect(() => {
    let cancel = false;
    setSlots(null);
    bookingPublicApi.availability(slug, service.id, date, resourceId)
      .then((r) => { if (!cancel) setSlots(r.slots); })
      .catch(() => { if (!cancel) setSlots([]); });
    return () => { cancel = true; };
  }, [slug, service.id, date, resourceId]);

  return (
    <div className="booking-slot-picker">
      <button className="btn btn-ghost" onClick={onBack}>← Services</button>
      <h2 className="section-title">{service.name} · {service.duration_min} min</h2>

      <label>Date
        <input type="date" value={date} min={isoDatePlus(0)} max={isoDatePlus(60)}
          onChange={(e) => setDate(e.target.value)} />
      </label>

      <div className="booking-resource-toggle">
        <button className={`btn ${resourceId === 'any' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setResourceId('any')}>Any</button>
        {resources.map((r) => (
          <button key={r.id} className={`btn ${resourceId === r.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setResourceId(r.id)}>{r.name}</button>
        ))}
      </div>

      {slots === null ? <div className="muted">Loading times…</div>
        : slots.length === 0 ? <p className="muted">No times available on this day.</p>
        : (
          <div className="booking-slot-grid">
            {slots.map((s) => (
              <button key={s.start + s.resource_id} className="btn btn-secondary booking-slot-pill" onClick={() => onPick(s)}>
                {formatTime(s.start)}
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
