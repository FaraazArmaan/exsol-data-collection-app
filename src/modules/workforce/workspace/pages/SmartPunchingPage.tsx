// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { WorkforceNav } from '../components/WorkforceNav';
import { useUserAuth } from '../../../user-portal/user-auth-context';
import {
  workforceApi,
  type Punch,
  type AttendanceRecoveryRequest,
  type StaffResource,
  type TimeClockEvent,
  type TimeCorrection,
  type WorkLocation,
} from '../../shared/api';
import {
  formatWorkforceDate,
  formatWorkforceDateKey,
  formatWorkforceTime,
  workforceDateKey,
  workforceTimeZone,
} from '../../shared/time';
import { Button } from '../../../../components/ui/Button';
import { DateField } from '../../../../components/ui/DateTimeField';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '../../../../components/ui/Feedback';
import '../../workforce.css';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

export default function SmartPunchingPage({ slug, perms }: Props) {
  const { client } = useUserAuth();
  const [searchParams] = useSearchParams();
  const timeZone = workforceTimeZone(client?.timezone);
  const employeeParam = searchParams.get('employee') ?? '';
  const [punches, setPunches] = useState<Punch[] | null>(null);
  const [events, setEvents] = useState<TimeClockEvent[]>([]);
  const [corrections, setCorrections] = useState<TimeCorrection[]>([]);
  const [staff, setStaff] = useState<StaffResource[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [error, setError] = useState('');
  const [clockingIn, setClockingIn] = useState<string | null>(null);
  const [correctionResourceId, setCorrectionResourceId] = useState('');
  const [correctionType, setCorrectionType] = useState<TimeCorrection['correction_type']>('missed_clock_in');
  const [correctionTime, setCorrectionTime] = useState('');
  const [correctionNotes, setCorrectionNotes] = useState('');
  const [correctionError, setCorrectionError] = useState('');
  const [submittingCorrection, setSubmittingCorrection] = useState(false);
  const [reviewingCorrectionId, setReviewingCorrectionId] = useState('');
  const [reviewWorkDate, setReviewWorkDate] = useState('');
  const [reviewMinutes, setReviewMinutes] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [workLocations, setWorkLocations] = useState<WorkLocation[]>([]);
  const [locationName, setLocationName] = useState('');
  const [locationLat, setLocationLat] = useState('');
  const [locationLng, setLocationLng] = useState('');
  const [locationRadius, setLocationRadius] = useState('100');
  const [locationAccuracy, setLocationAccuracy] = useState('150');
  const [locationError, setLocationError] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);
  const [recoveryRequests, setRecoveryRequests] = useState<AttendanceRecoveryRequest[]>([]);
  const [reviewingRecoveryId, setReviewingRecoveryId] = useState('');
  const [recoveryReviewNote, setRecoveryReviewNote] = useState('');
  const [recoveryReviewError, setRecoveryReviewError] = useState('');
  const [reviewingRecovery, setReviewingRecovery] = useState(false);

  const canClockIn = perms.has('workforce.employees.create');
  const canClockOut = perms.has('workforce.employees.edit');
  const canCorrect = perms.has('workforce.employees.create');
  const canManageLocations = perms.has('workforce.employees.edit');
  const canReviewCorrections = perms.has('workforce.employees.edit');
  const canReviewRecovery = perms.has('workforce.employees.edit');

  useEffect(() => {
    workforceApi.listStaff().then(d => setStaff(d.resources)).catch(() => {});
  }, []);

  useEffect(() => {
    if (employeeParam && staff.some(member => member.id === employeeParam)) {
      setSelectedResourceId(employeeParam);
    }
  }, [employeeParam, staff]);

  async function loadWorkLocations() {
    if (!canManageLocations) return;
    try {
      const data = await workforceApi.listWorkLocations();
      setWorkLocations(data.locations);
    } catch {
      setWorkLocations([]);
    }
  }

  useEffect(() => { void loadWorkLocations(); }, [canManageLocations]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setPunches(null);
    setError('');
    try {
      const params: { resource_id?: string } = {};
      if (selectedResourceId) params.resource_id = selectedResourceId;
      const [data, ledger, recoveryData] = await Promise.all([
        workforceApi.listPunches(params),
        workforceApi.getTimeLedger(selectedResourceId || undefined),
        canReviewRecovery ? workforceApi.listAttendanceRecoveryRequests() : Promise.resolve({ requests: [] }),
      ]);
      setPunches(data.punches);
      setEvents(ledger.events);
      setCorrections(ledger.corrections);
      setRecoveryRequests(recoveryData.requests);
    } catch {
      setError('Failed to load punch records.');
    }
  }

  useEffect(() => { load(); }, [selectedResourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = workforceDateKey(new Date(), timeZone);
  const todayPunches = (punches ?? []).filter(p => workforceDateKey(p.punched_in_at, timeZone) === today);

  function openPunchForResource(resourceId: string): Punch | undefined {
    return todayPunches.find(p => p.resource_id === resourceId && p.punched_out_at === null);
  }

  async function handleClockIn(resourceId: string) {
    setClockingIn(resourceId);
    setError('');
    try {
      await workforceApi.clockIn({ resource_id: resourceId });
      await workforceApi.appendTimeLedgerEvent({
        resource_id: resourceId,
        event_type: 'clock_in',
        source: 'manual',
      });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Clock-in failed.';
      setError(msg);
    } finally {
      setClockingIn(null);
    }
  }

  async function handleClockOut(punchId: string, resourceId: string) {
    setClockingIn(resourceId);
    setError('');
    try {
      await workforceApi.clockOut(punchId);
      await workforceApi.appendTimeLedgerEvent({
        resource_id: resourceId,
        punch_id: punchId,
        event_type: 'clock_out',
        source: 'manual',
      });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Clock-out failed.';
      setError(msg);
    } finally {
      setClockingIn(null);
    }
  }

  const filteredStaff = selectedResourceId
    ? staff.filter(s => s.id === selectedResourceId)
    : staff;

  // Group punches by date for the history list.
  const punchesByDate: Map<string, Punch[]> = new Map();
  for (const p of punches ?? []) {
    const dateKey = workforceDateKey(p.punched_in_at, timeZone);
    const bucket = punchesByDate.get(dateKey) ?? [];
    bucket.push(p);
    punchesByDate.set(dateKey, bucket);
  }
  const sortedDates = [...punchesByDate.keys()].sort((a, b) => b.localeCompare(a));

  function staffNameForResource(resourceId: string): string {
    return staff.find(s => s.id === resourceId)?.name ?? resourceId;
  }

  async function submitCorrection(e: React.FormEvent) {
    e.preventDefault();
    const resourceId = correctionResourceId || selectedResourceId;
    if (!resourceId) {
      setCorrectionError('Select a staff member for the correction.');
      return;
    }
    setSubmittingCorrection(true);
    setCorrectionError('');
    try {
      await workforceApi.requestTimeCorrection({
        resource_id: resourceId,
        correction_type: correctionType,
        new_values: correctionTime ? { requested_time: correctionTime } : {},
        notes: correctionNotes || null,
      });
      setCorrectionResourceId('');
      setCorrectionTime('');
      setCorrectionNotes('');
      await load();
    } catch (err: unknown) {
      setCorrectionError(err instanceof Error ? err.message : 'Failed to request correction.');
    } finally {
      setSubmittingCorrection(false);
    }
  }

  function startCorrectionReview(correction: TimeCorrection) {
    const requestedTime = correction.new_values.requested_time ?? correction.new_values.requested_at;
    setReviewingCorrectionId(correction.id);
    setReviewWorkDate(typeof requestedTime === 'string' ? requestedTime.slice(0, 10) : '');
    setReviewMinutes('');
    setReviewNote('');
    setReviewError('');
  }

  async function submitCorrectionReview(action: 'approve' | 'deny') {
    if (!reviewingCorrectionId) return;
    if (!reviewNote.trim()) {
      setReviewError('Add a decision note for the employee and audit record.');
      return;
    }
    const minutes = Number(reviewMinutes);
    if (action === 'approve' && (!reviewWorkDate || !Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 1440)) {
      setReviewError('Approved adjustments need a work date and a non-zero number of minutes.');
      return;
    }
    setReviewing(true);
    setReviewError('');
    try {
      await workforceApi.reviewTimeCorrection(reviewingCorrectionId, {
        action,
        resolution_note: reviewNote.trim(),
        ...(action === 'approve' ? { work_date: reviewWorkDate, minutes } : {}),
      });
      setReviewingCorrectionId('');
      setReviewWorkDate('');
      setReviewMinutes('');
      setReviewNote('');
      await load();
    } catch (err: unknown) {
      setReviewError(err instanceof Error ? err.message : 'Failed to review correction.');
    } finally {
      setReviewing(false);
    }
  }

  function startRecoveryReview(request: AttendanceRecoveryRequest) {
    setReviewingRecoveryId(request.id);
    setRecoveryReviewNote('');
    setRecoveryReviewError('');
  }

  async function submitRecoveryReview(action: 'approve' | 'deny') {
    if (!reviewingRecoveryId) return;
    if (recoveryReviewNote.trim().length < 3) {
      setRecoveryReviewError('Add a decision note for the employee and audit record.');
      return;
    }
    setReviewingRecovery(true);
    setRecoveryReviewError('');
    try {
      await workforceApi.reviewAttendanceRecovery(reviewingRecoveryId, {
        action,
        resolution_note: recoveryReviewNote.trim(),
      });
      setReviewingRecoveryId('');
      setRecoveryReviewNote('');
      await load();
    } catch (err: unknown) {
      setRecoveryReviewError(err instanceof Error ? err.message : 'Failed to review attendance recovery.');
    } finally {
      setReviewingRecovery(false);
    }
  }

  const pendingCorrections = corrections.filter(c => c.status === 'pending');
  const latePunches = todayPunches.filter(p => (p.late_minutes ?? 0) > 0);
  const absentPunches = todayPunches.filter(p => p.is_absent);

  async function submitWorkLocation(e: React.FormEvent) {
    e.preventDefault();
    setSavingLocation(true);
    setLocationError('');
    try {
      await workforceApi.createWorkLocation({
        name: locationName.trim(),
        latitude: Number(locationLat),
        longitude: Number(locationLng),
        radius_meters: Number(locationRadius),
        min_accuracy_meters: Number(locationAccuracy),
        applies_to_all: true,
      });
      setLocationName('');
      setLocationLat('');
      setLocationLng('');
      setLocationRadius('100');
      setLocationAccuracy('150');
      await loadWorkLocations();
    } catch (err: unknown) {
      setLocationError(err instanceof Error ? err.message : 'Failed to save work location.');
    } finally {
      setSavingLocation(false);
    }
  }

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="punching" />

      <div className="wf-punch-layout">
        <div className="wf-page-heading wf-attendance-heading">
          <div>
            <h1>Attendance</h1>
            <p>Review clock activity, breaks, and corrections. Times are shown in {timeZone}.</p>
          </div>
          <div className="wf-page-heading__actions">
            <span className="wf-timezone-badge">{timeZone}</span>
            <Link className="wf-btn wf-btn-secondary" to={`/c/${slug}/workforce/timesheets`}>Manual time entries</Link>
          </div>
        </div>

        <label className="wf-label wf-attendance-filter">Employee
          <select className="wf-select" value={selectedResourceId} onChange={e => setSelectedResourceId(e.target.value)}>
            <option value="">All staff</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        {error && punches === null && <ErrorState title="Could not load attendance." action={<Button size="compact" onClick={() => void load()}>Try again</Button>}>{error}</ErrorState>}
        {error && punches !== null && <InlineNotice tone="danger" title="An attendance action could not be completed." action={<Button size="compact" variant="quiet" onClick={() => setError('')}>Dismiss</Button>}>{error}</InlineNotice>}

        <section className="wf-attendance-board">
          <div className="wf-board-stat">
            <strong>{todayPunches.filter(p => p.punched_out_at === null).length}</strong>
            <span>Clocked in</span>
          </div>
          <div className="wf-board-stat">
            <strong>{latePunches.length}</strong>
            <span>Late today</span>
          </div>
          <div className="wf-board-stat">
            <strong>{absentPunches.length}</strong>
            <span>Absent marks</span>
          </div>
          <div className="wf-board-stat">
            <strong>{pendingCorrections.length}</strong>
            <span>Pending corrections</span>
          </div>
        </section>

        {canManageLocations && (
          <section className="wf-ot-form-section">
            <h3 className="wf-section-title">Work Locations</h3>
            <form className="wf-ot-form" onSubmit={submitWorkLocation}>
              {locationError && <InlineNotice tone="danger" title="The work location could not be saved.">{locationError}</InlineNotice>}
              <div className="wf-form-row">
                <label className="wf-label">Name
                  <input className="wf-input" value={locationName} onChange={e => setLocationName(e.target.value)} required />
                </label>
                <label className="wf-label">Latitude
                  <input className="wf-input" type="number" step="0.000001" value={locationLat} onChange={e => setLocationLat(e.target.value)} required />
                </label>
                <label className="wf-label">Longitude
                  <input className="wf-input" type="number" step="0.000001" value={locationLng} onChange={e => setLocationLng(e.target.value)} required />
                </label>
                <label className="wf-label">Radius meters
                  <input className="wf-input" type="number" min="1" max="5000" value={locationRadius} onChange={e => setLocationRadius(e.target.value)} required />
                </label>
                <label className="wf-label">Max accuracy meters
                  <input className="wf-input" type="number" min="1" max="5000" value={locationAccuracy} onChange={e => setLocationAccuracy(e.target.value)} required />
                </label>
              </div>
              <div className="wf-form-actions">
                <Button type="submit" variant="primary" loading={savingLocation} loadingLabel="Saving location…">Add work location</Button>
              </div>
            </form>
            {workLocations.length === 0 ? (
              <EmptyState title="No work locations configured.">Employee dashboard clock-in stays blocked until one is assigned.</EmptyState>
            ) : (
              <div className="wf-work-location-list">
                {workLocations.map(location => (
                  <div className="wf-work-location-row" key={location.id}>
                    <div>
                      <strong>{location.name}</strong>
                      <span>{location.radius_meters}m radius · max accuracy {location.min_accuracy_meters}m</span>
                    </div>
                    <span className={location.active ? 'wf-status-badge active' : 'wf-status-badge done'}>{location.active ? 'Active' : 'Inactive'}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Today's status cards */}
        {filteredStaff.length > 0 && (
          <div className="wf-punch-cards">
            {filteredStaff.map(s => {
              const openPunch = openPunchForResource(s.id);
              const isBusy = clockingIn === s.id;
              return (
                <div key={s.id} className="wf-punch-card">
                  <div className="wf-punch-name">{s.name}</div>
                  {openPunch ? (
                    <>
                      <div className="wf-punch-time">In: {formatWorkforceTime(openPunch.punched_in_at, timeZone)}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {openPunch.late_minutes === null && (
                          <span className="wf-badge-noshift">No shift</span>
                        )}
                        {openPunch.late_minutes === 0 && (
                          <span className="wf-badge-ontime">On time</span>
                        )}
                        {openPunch.late_minutes !== null && openPunch.late_minutes > 0 && (
                          <span className="wf-badge-late">+{openPunch.late_minutes}min late</span>
                        )}
                      </div>
                      {canClockOut && (
                        <Button variant="secondary" loading={isBusy} loadingLabel="Clocking out…" onClick={() => handleClockOut(openPunch.id, s.id)}>Clock out</Button>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="wf-punch-time" style={{ color: 'var(--text-muted)' }}>Not clocked in</div>
                      {canClockIn && (
                        <Button variant="primary" loading={isBusy} loadingLabel="Clocking in…" onClick={() => handleClockIn(s.id)}>Clock in</Button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <section className="wf-attendance-history">
          <h2>Attendance history</h2>
        {punches === null && !error && <LoadingState title="Loading attendance history…" />}

        {punches !== null && punches.length === 0 && (
          <EmptyState title="No punch records found." />
        )}

        {punches !== null && punches.length > 0 && (
          <div className="wf-punch-list">
            {sortedDates.map(dateKey => (
              <div key={dateKey}>
                <div className="wf-punch-date-heading">{formatWorkforceDateKey(dateKey)}</div>
                {punchesByDate.get(dateKey)!.map(p => (
                  <div key={p.id} className="wf-punch-row">
                    <span className="wf-punch-row-resource">{staffNameForResource(p.resource_id)}</span>
                    <span className="wf-punch-row-times">
                      {formatWorkforceTime(p.punched_in_at, timeZone)}
                      {p.punched_out_at ? ` → ${formatWorkforceTime(p.punched_out_at, timeZone)}` : ' → open'}
                    </span>
                    {p.late_minutes === null && <span className="wf-badge-noshift">No shift</span>}
                    {p.late_minutes === 0 && <span className="wf-badge-ontime">On time</span>}
                    {p.late_minutes !== null && p.late_minutes > 0 && (
                      <span className="wf-badge-late">+{p.late_minutes}min</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        </section>

        <section className="wf-ledger-grid">
          <div className="wf-ledger-panel">
            <div className="wf-section-title">Time Ledger</div>
            {events.length === 0 ? (
              <EmptyState title="No ledger events found for the current filter." />
            ) : (
              <div className="wf-ledger-list">
                {events.slice(0, 12).map(event => (
                  <div key={event.id} className="wf-ledger-row">
                    <span>{staffNameForResource(event.resource_id)}</span>
                    <span>{event.event_type.replaceAll('_', ' ')}</span>
                    <span>{formatWorkforceDate(event.occurred_at, timeZone)} {formatWorkforceTime(event.occurred_at, timeZone)}</span>
                    <span>{event.source}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="wf-ledger-panel">
            <div className="wf-section-title">Correction Queue</div>
            {pendingCorrections.length === 0 ? (
              <EmptyState title="No pending corrections." />
            ) : (
              <div className="wf-ledger-list">
                {pendingCorrections.slice(0, 8).map(correction => (
                  <div key={correction.id} className="wf-correction-item">
                    <div className="wf-ledger-row">
                      <span>{staffNameForResource(correction.resource_id)}</span>
                      <span>{correction.correction_type.replaceAll('_', ' ')}</span>
                      <span>{formatWorkforceDate(correction.created_at, timeZone)}</span>
                      {canReviewCorrections ? (
                        <Button size="compact" variant="secondary" type="button" onClick={() => startCorrectionReview(correction)}>Review</Button>
                      ) : (
                        <span className="wf-status-badge wf-status-pending">Pending</span>
                      )}
                    </div>
                    {reviewingCorrectionId === correction.id && (
                      <div className="wf-correction-review">
                        <div className="wf-muted-copy">Approving creates an auditable payable-time adjustment. It does not overwrite the original clock evidence.</div>
                        {reviewError && <InlineNotice tone="danger" title="The correction needs attention.">{reviewError}</InlineNotice>}
                        <div className="wf-correction-review-grid">
                          <DateField label="Work date" value={reviewWorkDate} onChange={setReviewWorkDate} />
                          <label className="wf-label">Minutes
                            <input className="wf-input" type="number" min="-1440" max="1440" step="1" value={reviewMinutes} onChange={e => setReviewMinutes(e.target.value)} />
                          </label>
                        </div>
                        <label className="wf-label">Decision note
                          <textarea className="wf-textarea" rows={2} value={reviewNote} onChange={e => setReviewNote(e.target.value)} />
                        </label>
                        <div className="wf-form-actions">
                          <Button variant="primary" type="button" loading={reviewing} loadingLabel="Saving decision…" onClick={() => void submitCorrectionReview('approve')}>Approve adjustment</Button>
                          <Button variant="secondary" type="button" disabled={reviewing} onClick={() => void submitCorrectionReview('deny')}>Deny request</Button>
                          <Button variant="quiet" type="button" disabled={reviewing} onClick={() => setReviewingCorrectionId('')}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {canReviewRecovery && (
          <section className="wf-ledger-panel wf-attendance-recovery-panel">
            <div className="wf-section-title">Attendance Recovery Queue</div>
            {recoveryRequests.length === 0 ? (
              <EmptyState title="No geofence recovery requests." />
            ) : (
              <div className="wf-ledger-list">
                {recoveryRequests.map((request) => (
                  <div key={request.id} className="wf-correction-item">
                    <div className="wf-ledger-row">
                      <span>{request.resource_name}</span>
                      <span>{request.failure_code.replaceAll('_', ' ')}</span>
                      <span>{formatWorkforceDate(request.attempted_at, timeZone)} {formatWorkforceTime(request.attempted_at, timeZone)}</span>
                      <Button size="compact" variant="secondary" type="button" onClick={() => startRecoveryReview(request)}>Review</Button>
                    </div>
                    <div className="wf-muted-copy">{request.employee_reason}{request.work_location_name ? ` · nearest ${request.work_location_name}` : ''}{request.distance_meters !== null ? ` · ${Math.round(Number(request.distance_meters))}m away` : ''}{request.accuracy_meters !== null ? ` · ${Math.round(Number(request.accuracy_meters))}m accuracy` : ''}</div>
                    {reviewingRecoveryId === request.id && (
                      <div className="wf-correction-review">
                        <div className="wf-muted-copy">Approving creates a supervisor-override clock-in at the recorded attempt time. It preserves the geofence evidence and decision note.</div>
                        {recoveryReviewError && <InlineNotice tone="danger" title="The recovery decision needs attention.">{recoveryReviewError}</InlineNotice>}
                        <label className="wf-label">Decision note
                          <textarea className="wf-textarea" rows={2} value={recoveryReviewNote} onChange={e => setRecoveryReviewNote(e.target.value)} />
                        </label>
                        <div className="wf-form-actions">
                          <Button variant="primary" type="button" loading={reviewingRecovery} loadingLabel="Saving decision…" onClick={() => void submitRecoveryReview('approve')}>Approve clock-in override</Button>
                          <Button variant="secondary" type="button" disabled={reviewingRecovery} onClick={() => void submitRecoveryReview('deny')}>Deny request</Button>
                          <Button variant="quiet" type="button" disabled={reviewingRecovery} onClick={() => setReviewingRecoveryId('')}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {canCorrect && (
          <section className="wf-ot-form-section">
            <h3 className="wf-section-title">Request Time Correction</h3>
            <form className="wf-ot-form" onSubmit={submitCorrection}>
              {correctionError && <InlineNotice tone="danger" title="The correction request could not be submitted.">{correctionError}</InlineNotice>}
              <div className="wf-form-row">
                <label className="wf-label">Staff member
                  <select
                    className="wf-select"
                    value={correctionResourceId || selectedResourceId}
                    onChange={e => setCorrectionResourceId(e.target.value)}
                    required
                  >
                    <option value="">Select staff...</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="wf-label">Correction type
                  <select className="wf-select" value={correctionType} onChange={e => setCorrectionType(e.target.value as TimeCorrection['correction_type'])}>
                    <option value="missed_clock_in">Missed clock in</option>
                    <option value="missed_clock_out">Missed clock out</option>
                    <option value="edit_time">Edit time</option>
                    <option value="delete_punch">Delete punch</option>
                  </select>
                </label>
                <label className="wf-label">Requested time
                  <input className="wf-input" type="datetime-local" value={correctionTime} onChange={e => setCorrectionTime(e.target.value)} />
                </label>
              </div>
              <label className="wf-label">Reason
                <textarea className="wf-textarea" rows={2} value={correctionNotes} onChange={e => setCorrectionNotes(e.target.value)} />
              </label>
              <Button type="submit" variant="primary" loading={submittingCorrection} loadingLabel="Submitting correction…">Submit correction</Button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
