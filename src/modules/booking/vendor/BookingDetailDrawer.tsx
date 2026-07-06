import { useEffect, useState } from 'react';
import { bookingApi, type VendorBooking, type BookingAction } from '../shared/api';
import { formatRupees, formatTime, formatDateLong } from '../format';
import { BookingStatusPill } from '../components/BookingStatusPill';

interface Props { bookingId: string; perms: ReadonlySet<string>; onClose: () => void; onChanged: () => void; }

// Which FSM actions the current status permits (mirrors the server FSM ALLOWED_FROM).
function allowedActions(status: string): BookingAction[] {
  if (status === 'pending' || status === 'confirmed') {
    return status === 'confirmed' ? ['complete', 'noShow', 'cancel'] : ['cancel'];
  }
  if (status === 'blocked') return ['unblock'];
  return [];
}
const LABEL: Record<BookingAction, string> = { cancel: 'Cancel', complete: 'Mark completed', noShow: 'Mark no-show', unblock: 'Unblock' };
const canReschedule = (status: string) => status === 'pending' || status === 'confirmed';
function toLocalInput(iso: string) {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function BookingDetailDrawer({ bookingId, perms, onClose, onChanged }: Props) {
  const canEdit = perms.has('booking.customers.edit');
  const [b, setB] = useState<VendorBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newStart, setNewStart] = useState<string | null>(null);

  useEffect(() => { bookingApi.get(bookingId).then(setB).catch(() => setError('not_found')); }, [bookingId]);

  async function act(action: BookingAction) {
    setBusy(true); setError(null);
    try { await bookingApi.transition(bookingId, action); onChanged(); onClose(); }
    catch (e: any) { setError(e?.code ?? 'error'); setBusy(false); }
  }
  async function reschedule() {
    if (!newStart) return;
    setBusy(true); setError(null);
    try { await bookingApi.reschedule(bookingId, new Date(newStart).toISOString()); onChanged(); onClose(); }
    catch (e: any) { setError(e?.code === 'slot_taken' ? 'That time is taken' : (e?.code ?? 'error')); setBusy(false); }
  }

  return (
    <aside role="dialog" aria-label="Booking detail" className="pos-drawer booking-drawer">
      <div className="booking-drawer-head">
        <h2 className="section-title">Booking</h2>
        <button className="btn btn-ghost" onClick={onClose}>✕</button>
      </div>
      {error === 'not_found' ? <p className="error">Not found.</p>
        : !b ? <div className="muted">Loading…</div>
        : (
          <>
            <BookingStatusPill status={b.status} />
            <div className="muted">{formatDateLong(b.start_at)} · {formatTime(b.start_at)}–{formatTime(b.end_at)}</div>
            {b.customer_name ? <div><strong>{b.customer_name}</strong>{b.customer_phone ? ` · ${b.customer_phone}` : ''}</div> : <div className="muted">Blocked time</div>}
            <div>{formatRupees(b.price_cents)}</div>
            {error && error !== 'not_found' ? <p className="error">Couldn’t apply ({error}).</p> : null}
            {canEdit ? (
              <div className="booking-actions">
                {allowedActions(b.status).map((a) => (
                  <button key={a} className={`btn ${a === 'cancel' ? 'btn-danger' : 'btn-secondary'}`} disabled={busy} onClick={() => act(a)}>{LABEL[a]}</button>
                ))}
                {canReschedule(b.status) && newStart === null ? (
                  <button className="btn btn-secondary" disabled={busy} onClick={() => setNewStart(toLocalInput(b.start_at))}>Reschedule</button>
                ) : null}
              </div>
            ) : null}
            {canEdit && newStart !== null ? (
              <div className="booking-form-inline">
                <input type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
                <button className="btn btn-primary" disabled={busy} onClick={reschedule}>Move</button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => setNewStart(null)}>Cancel</button>
              </div>
            ) : null}
          </>
        )}
    </aside>
  );
}
