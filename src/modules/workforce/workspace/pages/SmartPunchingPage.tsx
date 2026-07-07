// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { Link } from 'react-router-dom';
import { workforceApi, type Punch, type StaffResource } from '../../shared/api';
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
  const [staff, setStaff] = useState<StaffResource[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [error, setError] = useState('');
  const [clockingIn, setClockingIn] = useState<string | null>(null);

  const canClockIn = perms.has('workforce.employees.create');
  const canClockOut = perms.has('workforce.employees.edit');

  useEffect(() => {
    workforceApi.listStaff().then(d => setStaff(d.resources)).catch(() => {});
  }, []);

  async function load() {
    setError('');
    try {
      const params: { resource_id?: string } = {};
      if (selectedResourceId) params.resource_id = selectedResourceId;
      const data = await workforceApi.listPunches(params);
      setPunches(data.punches);
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
      </div>
    </div>
  );
}
