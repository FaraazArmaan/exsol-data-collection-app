// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { workforceApi, type ShiftSwap, type Shift, type StaffResource } from '../../shared/api';
import { Button } from '../../../../components/ui/Button';
import { DateField } from '../../../../components/ui/DateTimeField';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '../../../../components/ui/Feedback';
import '../../workforce.css';

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  claimed: 'Claimed',
  approved: 'Approved',
  denied: 'Denied',
  cancelled: 'Cancelled',
};

function weekdayFromDate(dateIso: string): number {
  return new Date(`${dateIso}T12:00:00`).getDay();
}

function minutes(time: string): number {
  const [hour, minute] = time.slice(0, 5).split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function overlaps(a: Shift, b: Shift): boolean {
  return a.weekday === b.weekday && minutes(a.start_time) < minutes(b.end_time) && minutes(b.start_time) < minutes(a.end_time);
}

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
    setSwaps(null);
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

  function shiftForSwap(swap: ShiftSwap): Shift | undefined {
    return shifts.find(shift => shift.id === swap.offering_shift_id);
  }

  function eligibleStaff(swap: ShiftSwap): Array<{ resource: StaffResource; conflict: boolean }> {
    const offeredShift = shiftForSwap(swap);
    const swapWeekday = weekdayFromDate(swap.offering_date);
    return staff
      .filter(resource => resource.id !== swap.offering_resource_id && resource.active)
      .map(resource => {
        const resourceShifts = shifts.filter(shift => shift.resource_id === resource.id && shift.weekday === swapWeekday);
        const conflict = offeredShift ? resourceShifts.some(shift => overlaps(shift, { ...offeredShift, weekday: swapWeekday })) : resourceShifts.length > 0;
        return { resource, conflict };
      })
      .sort((a, b) => Number(a.conflict) - Number(b.conflict) || a.resource.name.localeCompare(b.resource.name));
  }

  const openCount = swaps?.filter(s => s.status === 'open').length ?? 0;
  const claimedCount = swaps?.filter(s => s.status === 'claimed').length ?? 0;
  const approvalCount = swaps?.filter(s => s.status === 'approved').length ?? 0;

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="swaps" />

      <div className="wf-swap-layout">
        <div className="wf-page-heading">
          <div>
            <h1>Swap Board</h1>
            <p>Review offered shifts, eligible claimers, coverage risk, and manager approval state before schedule changes are accepted.</p>
          </div>
        </div>

        <section className="wf-attendance-board">
          <div className="wf-board-stat"><strong>{openCount}</strong><span>Open offers</span></div>
          <div className="wf-board-stat"><strong>{claimedCount}</strong><span>Awaiting approval</span></div>
          <div className="wf-board-stat"><strong>{approvalCount}</strong><span>Approved swaps</span></div>
          <div className="wf-board-stat"><strong>{staff.filter(s => s.active).length}</strong><span>Active resources</span></div>
        </section>

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
        {error && swaps === null && <ErrorState title="Could not load the swap board." action={<Button size="compact" onClick={() => void load()}>Try again</Button>}>{error}</ErrorState>}
        {error && swaps !== null && <InlineNotice tone="danger" title="A swap action could not be completed." action={<Button size="compact" variant="quiet" onClick={() => setError('')}>Dismiss</Button>}>{error}</InlineNotice>}
        {swaps === null && !error && <LoadingState title="Loading swap board…" />}
        {swaps !== null && swaps.length === 0 && (
          <EmptyState title="No swap offers found." />
        )}

        {/* Swap list */}
        {swaps !== null && swaps.length > 0 && (
          <div className="wf-swap-list">
            {swaps.map(s => {
              const offeredShift = shiftForSwap(s);
              const eligible = eligibleStaff(s);
              const selected = eligible.find(row => row.resource.id === claimResource[s.id]);
              const safeCount = eligible.filter(row => !row.conflict).length;
              return (
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

                  <div className="wf-swap-preview-grid">
                    <div>
                      <span>Offered shift</span>
                      <strong>{offeredShift ? shiftLabel(offeredShift) : s.offering_shift_id.slice(0, 8)}</strong>
                    </div>
                    <div>
                      <span>Eligible staff</span>
                      <strong>{safeCount}/{eligible.length} clear</strong>
                    </div>
                    <div>
                      <span>Coverage risk</span>
                      <strong>{safeCount === 0 && s.status === 'open' ? 'Needs review' : 'Preview ready'}</strong>
                    </div>
                  </div>

                  {s.claimed_by_resource_name && (
                    <div className="wf-swap-date">
                      Claimed by: {s.claimed_by_resource_name}
                    </div>
                  )}

                  {s.notes && <div className="wf-swap-notes">{s.notes}</div>}

                  <div className="wf-swap-eligible-row">
                    {eligible.slice(0, 5).map(row => (
                      <span key={row.resource.id} className={row.conflict ? 'wf-swap-chip warn' : 'wf-swap-chip ok'}>
                        {row.resource.name}{row.conflict ? ' conflict' : ' clear'}
                      </span>
                    ))}
                  </div>

                  {selected && (
                    <div className={selected.conflict ? 'wf-swap-impact warn' : 'wf-swap-impact ok'}>
                      {selected.resource.name}: {selected.conflict ? 'has an overlapping shift on this date' : 'has no overlapping shift in the weekly plan'}
                    </div>
                  )}

                  <div className="wf-swap-actions">
                    {/* Claim: open swaps, show resource selector + claim button */}
                    {s.status === 'open' && (
                      <div className="wf-swap-claim-row">
                        <select
                          className="wf-select"
                          style={{ maxWidth: 260 }}
                          value={claimResource[s.id] ?? ''}
                          onChange={e =>
                            setClaimResource(prev => ({ ...prev, [s.id]: e.target.value }))
                          }
                        >
                          <option value="">Select claimer...</option>
                          {eligible.map(row => (
                            <option key={row.resource.id} value={row.resource.id}>
                              {row.resource.name}{row.conflict ? ' - conflict' : ' - clear'}
                            </option>
                          ))}
                        </select>
                        <Button size="compact" variant="primary" disabled={!claimResource[s.id]} onClick={() => handleClaim(s.id)}>Claim</Button>
                      </div>
                    )}

                    {/* Manager: approve / deny for claimed swaps */}
                    {canHandle && s.status === 'claimed' && (
                      <>
                        <Button size="compact" variant="primary" onClick={() => handleAction(s.id, 'approve')}>Approve</Button>
                        <Button size="compact" variant="danger" onClick={() => handleAction(s.id, 'deny')}>Deny</Button>
                      </>
                    )}

                    {/* Cancel: open or claimed */}
                    {(s.status === 'open' || s.status === 'claimed') && (
                      <Button size="compact" variant="danger" onClick={() => handleAction(s.id, 'cancel')}>Cancel</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Offer a swap form */}
        {canCreate && (
          <section className="wf-swap-form-section">
            <h3 className="wf-section-title">Offer a Swap</h3>
            <form onSubmit={handleSubmit} className="wf-swap-form">
              {formError && <InlineNotice tone="danger" title="The swap offer could not be created.">{formError}</InlineNotice>}
              <div className="wf-form-row">
                <label className="wf-label">Shift
                  <select
                    className="wf-select"
                    value={formShiftId}
                    onChange={e => setFormShiftId(e.target.value)}
                    required
                  >
                    <option value="">Select shift...</option>
                    {shifts.map(sh => (
                      <option key={sh.id} value={sh.id}>{shiftLabel(sh)}</option>
                    ))}
                  </select>
                </label>
                <DateField label="Date" value={formDate} onChange={setFormDate} required />
              </div>
              <label className="wf-label">Notes (optional)
                <textarea
                  className="wf-textarea"
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  rows={2}
                />
              </label>
              <Button type="submit" variant="primary" loading={submitting} loadingLabel="Offering swap…">Offer swap</Button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
