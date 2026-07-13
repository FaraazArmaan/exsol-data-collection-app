// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import {
  workforceApi,
  type Punch,
  type StaffResource,
  type TimeClockEvent,
  type TimeCorrection,
  type WorkLocation,
} from '../../shared/api';
import '../../workforce.css';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function SmartPunchingPage({ slug, perms }: Props) {
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
  const [workLocations, setWorkLocations] = useState<WorkLocation[]>([]);
  const [locationName, setLocationName] = useState('');
  const [locationLat, setLocationLat] = useState('');
  const [locationLng, setLocationLng] = useState('');
  const [locationRadius, setLocationRadius] = useState('100');
  const [locationAccuracy, setLocationAccuracy] = useState('150');
  const [locationError, setLocationError] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);

  const canClockIn = perms.has('workforce.employees.create');
  const canClockOut = perms.has('workforce.employees.edit');
  const canCorrect = perms.has('workforce.employees.create');
  const canManageLocations = perms.has('workforce.employees.edit');

  useEffect(() => {
    workforceApi.listStaff().then(d => setStaff(d.resources)).catch(() => {});
  }, []);

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
    setError('');
    try {
      const params: { resource_id?: string } = {};
      if (selectedResourceId) params.resource_id = selectedResourceId;
      const [data, ledger] = await Promise.all([
        workforceApi.listPunches(params),
        workforceApi.getTimeLedger(selectedResourceId || undefined),
      ]);
      setPunches(data.punches);
      setEvents(ledger.events);
      setCorrections(ledger.corrections);
    } catch {
      setError('Failed to load punch records.');
    }
  }

  useEffect(() => { load(); }, [selectedResourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date().toISOString().slice(0, 10);
  const todayPunches = (punches ?? []).filter(p => p.punched_in_at.startsWith(today));

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
    const dateKey = p.punched_in_at.slice(0, 10);
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
        {/* Resource filter */}
        <select
          className="wf-select"
          value={selectedResourceId}
          onChange={e => setSelectedResourceId(e.target.value)}
          style={{ maxWidth: 260 }}
        >
          <option value="">All staff</option>
          {staff.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {error && <div className="wf-error">{error}</div>}

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
              {locationError && <div className="wf-error">{locationError}</div>}
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
                <button className="wf-btn wf-btn-primary" type="submit" disabled={savingLocation}>
                  {savingLocation ? 'Saving...' : 'Add work location'}
                </button>
              </div>
            </form>
            {workLocations.length === 0 ? (
              <div className="wf-empty">No work locations configured. Employee dashboard clock-in stays blocked until one is assigned.</div>
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
                      <div className="wf-punch-time">In: {formatTime(openPunch.punched_in_at)}</div>
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
                        <button
                          className="wf-btn"
                          disabled={isBusy}
                          onClick={() => handleClockOut(openPunch.id, s.id)}
                        >
                          {isBusy ? 'Clocking out…' : 'Clock out'}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="wf-punch-time" style={{ color: 'var(--text-muted)' }}>Not clocked in</div>
                      {canClockIn && (
                        <button
                          className="wf-btn wf-btn-primary"
                          disabled={isBusy}
                          onClick={() => handleClockIn(s.id)}
                        >
                          {isBusy ? 'Clocking in…' : 'Clock in'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Punch history */}
        {punches === null && !error && (
          <div className="wf-empty">Loading punch records…</div>
        )}

        {punches !== null && punches.length === 0 && (
          <div className="wf-empty">No punch records found.</div>
        )}

        {punches !== null && punches.length > 0 && (
          <div className="wf-punch-list">
            {sortedDates.map(dateKey => (
              <div key={dateKey}>
                <div className="wf-punch-date-heading">{formatDate(dateKey + 'T12:00:00')}</div>
                {punchesByDate.get(dateKey)!.map(p => (
                  <div key={p.id} className="wf-punch-row">
                    <span className="wf-punch-row-resource">{staffNameForResource(p.resource_id)}</span>
                    <span className="wf-punch-row-times">
                      {formatTime(p.punched_in_at)}
                      {p.punched_out_at ? ` → ${formatTime(p.punched_out_at)}` : ' → open'}
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

        <section className="wf-ledger-grid">
          <div className="wf-ledger-panel">
            <div className="wf-section-title">Time Ledger</div>
            {events.length === 0 ? (
              <div className="wf-empty">No ledger events found for the current filter.</div>
            ) : (
              <div className="wf-ledger-list">
                {events.slice(0, 12).map(event => (
                  <div key={event.id} className="wf-ledger-row">
                    <span>{staffNameForResource(event.resource_id)}</span>
                    <span>{event.event_type.replaceAll('_', ' ')}</span>
                    <span>{formatDate(event.occurred_at)} {formatTime(event.occurred_at)}</span>
                    <span>{event.source}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="wf-ledger-panel">
            <div className="wf-section-title">Correction Queue</div>
            {pendingCorrections.length === 0 ? (
              <div className="wf-empty">No pending corrections.</div>
            ) : (
              <div className="wf-ledger-list">
                {pendingCorrections.slice(0, 8).map(correction => (
                  <div key={correction.id} className="wf-ledger-row">
                    <span>{staffNameForResource(correction.resource_id)}</span>
                    <span>{correction.correction_type.replaceAll('_', ' ')}</span>
                    <span>{formatDate(correction.created_at)}</span>
                    <span className="wf-status-badge wf-status-pending">Pending</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {canCorrect && (
          <section className="wf-ot-form-section">
            <h3 className="wf-section-title">Request Time Correction</h3>
            <form className="wf-ot-form" onSubmit={submitCorrection}>
              {correctionError && <div className="wf-error">{correctionError}</div>}
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
              <button className="wf-btn wf-btn-primary" type="submit" disabled={submittingCorrection}>
                {submittingCorrection ? 'Submitting...' : 'Submit correction'}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
