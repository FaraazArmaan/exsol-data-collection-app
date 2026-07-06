import { useEffect, useState } from 'react';
import { bookingPublicApi, type PublicService, type PublicResource, type Slot } from '../shared/api';
import { formatRupees, formatTime, isoDatePlus } from '../format';

interface Props {
  slug: string;
  service: PublicService;
  onPick: (slot: Slot) => void;
  onBack: () => void;
}

const MAX_DAYS = 60;
function dayLabel(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return { wd: d.toLocaleDateString([], { weekday: 'short' }), dom: d.getDate() };
}
function period(iso: string) { const h = new Date(iso).getHours(); return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; }

export function SlotPicker({ slug, service, onPick, onBack }: Props) {
  const [date, setDate] = useState<string>(isoDatePlus(0));
  const [weekOffset, setWeekOffset] = useState(0);
  const [resourceId, setResourceId] = useState<string>('any');
  const [resources, setResources] = useState<PublicResource[]>([]);
  const [slots, setSlots] = useState<Slot[] | null>(null);

  useEffect(() => {
    let cancel = false;
    bookingPublicApi.resources(slug).then((r) => { if (!cancel) setResources(r.resources); }).catch(() => {});
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

  const week = Array.from({ length: 7 }, (_, i) => isoDatePlus(weekOffset * 7 + i));
  const groups: Record<string, Slot[]> = { Morning: [], Afternoon: [], Evening: [] };
  for (const s of slots ?? []) groups[period(s.start)]!.push(s);

  return (
    <div className="booking-sf-step-panel">
      <button className="booking-sf-back" onClick={onBack}>← Services</button>
      <div className="booking-sf-chosen">
        <span className="booking-service-name">{service.name}</span>
        <span className="booking-service-meta">{service.duration_min} min · {formatRupees(service.price_cents)}</span>
      </div>

      <h2 className="booking-sf-heading">Pick a date</h2>
      <div className="booking-datestrip">
        <button className="booking-datestrip-nav" onClick={() => setWeekOffset((w) => Math.max(0, w - 1))} disabled={weekOffset === 0} aria-label="Previous week">‹</button>
        <div className="booking-datestrip-days">
          {week.map((d) => {
            const { wd, dom } = dayLabel(d);
            const disabled = d > isoDatePlus(MAX_DAYS);
            return (
              <button key={d} className={`booking-daychip${d === date ? ' is-active' : ''}`} disabled={disabled} onClick={() => setDate(d)}>
                <span className="booking-daychip-wd">{wd}</span>
                <span className="booking-daychip-dom">{dom}</span>
              </button>
            );
          })}
        </div>
        <button className="booking-datestrip-nav" onClick={() => setWeekOffset((w) => w + 1)} disabled={isoDatePlus((weekOffset + 1) * 7) > isoDatePlus(MAX_DAYS)} aria-label="Next week">›</button>
      </div>

      {resources.length > 0 && (
        <>
          <h2 className="booking-sf-heading">With</h2>
          <div className="booking-chips">
            <button className={`booking-chip-btn${resourceId === 'any' ? ' is-active' : ''}`} onClick={() => setResourceId('any')}>Any professional</button>
            {resources.map((r) => (
              <button key={r.id} className={`booking-chip-btn${resourceId === r.id ? ' is-active' : ''}`} onClick={() => setResourceId(r.id)}>{r.name}</button>
            ))}
          </div>
        </>
      )}

      <h2 className="booking-sf-heading">Available times</h2>
      {slots === null ? <div className="booking-sf-empty">Loading times…</div>
        : slots.length === 0 ? <p className="booking-sf-empty">No times available on this day. Try another date.</p>
        : (
          <div className="booking-slot-groups">
            {(['Morning', 'Afternoon', 'Evening'] as const).map((g) => groups[g]!.length ? (
              <div key={g} className="booking-slot-group">
                <div className="booking-slot-grouplabel">{g}</div>
                <div className="booking-slot-grid">
                  {groups[g]!.map((s) => (
                    <button key={s.start + s.resource_id} className="booking-slot-pill" onClick={() => onPick(s)}>{formatTime(s.start)}</button>
                  ))}
                </div>
              </div>
            ) : null)}
          </div>
        )}
    </div>
  );
}
