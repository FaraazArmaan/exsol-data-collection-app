// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { workforceApi, type ShiftSwap, type Shift, type StaffResource } from '../../shared/api';
import '../../workforce.css';

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  claimed: 'Claimed',
  approved: 'Approved',
  denied: 'Denied',
  cancelled: 'Cancelled',
};

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

export default function SwapBoardPage({ slug, perms }: Props) {
  const [swaps, setSwaps] = useState<ShiftSwap[] | null>(null);
  const [staff, setStaff] = useState<StaffResource[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [error, setError] = useState('');

  // Offer form state
  const [formShiftId, setFormShiftId] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Claim inline state: swapId → selected resourceId
  const [claimResource, setClaimResource] = useState<Record<string, string>>({});

  const canCreate = perms.has('workforce.employees.create');
  const canHandle = perms.has('workforce.employees.edit');

  useEffect(() => {
    workforceApi.listStaff().then(d => setStaff(d.resources)).catch(() => {});
    workforceApi.listShifts().then(d => setShifts(d.shifts)).catch(() => {});
  }, []);

  async function load() {
    setError('');
    try {
      const params: { status?: string } = {};
      if (selectedStatus) params.status = selectedStatus;
      const data = await workforceApi.listSwaps(params);
      setSwaps(data.swaps);
    } catch {
      setError('Failed to load swap board.');
    }
  }

  useEffect(() => { load(); }, [selectedStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleClaim(swapId: string) {
    const resourceId = claimResource[swapId] ?? '';
    if (!resourceId) return;
    try {
      await workforceApi.actionSwap(swapId, 'claim', resourceId);
      await load();
    } catch {
      setError('Claim failed. Please try again.');
    }
  }

  async function handleAction(swapId: string, action: string) {
    try {
      await workforceApi.actionSwap(swapId, action);
      await load();
    } catch {
      setError('Action failed. Please try again.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formShiftId) { setFormError('Select a shift.'); return; }
    if (!formDate) { setFormError('Date is required.'); return; }
    setSubmitting(true);
    setFormError('');
    try {
      await workforceApi.offerSwap({
        shift_id: formShiftId,
        offering_date: formDate,
        notes: formNotes || undefined,
      });
      setFormShiftId('');
      setFormDate('');
      setFormNotes('');
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to offer swap.';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function shiftLabel(shift: Shift): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const day = days[shift.weekday] ?? `Day ${shift.weekday}`;
    return `${shift.resource_name ?? shift.resource_id} | ${day} ${shift.start_time}–${shift.end_time}`;
  }

  return (
    <div className="wf-page">
      {/* Tab nav */}
      <nav className="wf-tabs">
        <Link className="wf-tab-link" to={`/c/${slug}/workforce`}>Staff &amp; Schedule</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/timesheets`}>Timesheets</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/leave`}>Leave</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/punching`}>Punching</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/overtime`}>Overtime</Link>
        <span className="wf-tab-link wf-tab-active">Swaps</span>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/payroll`}>Payroll</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/training`}>Training</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/assets`}>Assets</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/employees`}>Employees</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/projects`}>Projects</Link>
      </nav>

      <div className="wf-swap-layout">
        {/* Status filter */}
        <div className="wf-swap-filters">
          <select
            className="wf-select"
            style={{ maxWidth: 200 }}
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="claimed">Claimed</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* Error / loading / empty */}
        {error && <div className="wf-error">{error}</div>}
        {swaps === null && !error && <div className="wf-loading">Loading swap board…</div>}
        {swaps !== null && swaps.length === 0 && (
          <div className="wf-empty">No swap offers found.</div>
        )}

        {/* Swap list */}
        {swaps !== null && swaps.length > 0 && (
          <div className="wf-swap-list">
            {swaps.map(s => (
              <div key={s.id} className="wf-swap-card">
                <div className="wf-swap-card-header">
                  <span className="wf-swap-resource">
                    {s.offering_resource_name ?? s.offering_resource_id}
                  </span>
                  <span className="wf-swap-date">{s.offering_date}</span>
                  <span className={`wf-status-badge wf-status-${s.status}`}>
                    {STATUS_LABELS[s.status] ?? s.status}
                  </span>
                </div>

                {s.claimed_by_resource_name && (
                  <div className="wf-swap-date">
                    Claimed by: {s.claimed_by_resource_name}
                  </div>
                )}

                {s.notes && <div className="wf-swap-notes">{s.notes}</div>}

                <div className="wf-swap-actions">
                  {/* Claim: open swaps, show resource selector + claim button */}
                  {s.status === 'open' && (
                    <div className="wf-swap-claim-row">
                      <select
                        className="wf-select"
                        style={{ maxWidth: 180 }}
                        value={claimResource[s.id] ?? ''}
                        onChange={e =>
                          setClaimResource(prev => ({ ...prev, [s.id]: e.target.value }))
                        }
                      >
                        <option value="">Select claimer…</option>
                        {staff.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <button
                        className="wf-btn wf-btn-primary"
                        disabled={!claimResource[s.id]}
                        onClick={() => handleClaim(s.id)}
                      >
                        Claim
                      </button>
                    </div>
                  )}

                  {/* Manager: approve / deny for claimed swaps */}
                  {canHandle && s.status === 'claimed' && (
                    <>
                      <button
                        className="wf-btn wf-btn-success"
                        onClick={() => handleAction(s.id, 'approve')}
                      >Approve</button>
                      <button
                        className="wf-btn wf-btn-danger"
                        onClick={() => handleAction(s.id, 'deny')}
                      >Deny</button>
                    </>
                  )}

                  {/* Cancel: open or claimed */}
                  {(s.status === 'open' || s.status === 'claimed') && (
                    <button
                      className="wf-btn wf-btn-danger"
                      onClick={() => handleAction(s.id, 'cancel')}
                    >Cancel</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Offer a swap form */}
        {canCreate && (
          <section className="wf-swap-form-section">
            <h3 className="wf-section-title">Offer a Swap</h3>
            <form onSubmit={handleSubmit} className="wf-swap-form">
              {formError && <div className="wf-error">{formError}</div>}
              <div className="wf-form-row">
                <label className="wf-label">Shift
                  <select
                    className="wf-select"
                    value={formShiftId}
                    onChange={e => setFormShiftId(e.target.value)}
                    required
                  >
                    <option value="">Select shift…</option>
                    {shifts.map(sh => (
                      <option key={sh.id} value={sh.id}>{shiftLabel(sh)}</option>
                    ))}
                  </select>
                </label>
                <label className="wf-label">Date
                  <input
                    className="wf-input"
                    type="date"
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    required
                  />
                </label>
              </div>
              <label className="wf-label">Notes (optional)
                <textarea
                  className="wf-textarea"
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  rows={2}
                />
              </label>
              <button className="wf-btn wf-btn-primary" type="submit" disabled={submitting}>
                {submitting ? 'Offering…' : 'Offer swap'}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
