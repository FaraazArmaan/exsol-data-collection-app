import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { Link, useParams } from 'react-router-dom';
import { workforceApi, type StaffResource, type Shift } from '../../shared/api';
import '../../workforce.css';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

function ShiftPill({
  shift,
  canDelete,
  onDelete,
}: {
  shift: Shift;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="wf-shift-pill">
      <span>{shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}</span>
      {canDelete && (
        <button onClick={onDelete} title="Remove shift">✕</button>
      )}
    </div>
  );
}

function AddShiftForm({
  resourceId,
  teamMembers,
  onCreated,
}: {
  resourceId: string;
  teamMembers: StaffResource['team_members'];
  onCreated: () => void;
}) {
  const [weekday, setWeekday] = useState(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [userNodeId, setUserNodeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await workforceApi.createShift({
        resource_id: resourceId,
        user_node_id: userNodeId || null,
        weekday,
        start_time: startTime,
        end_time: endTime,
      });
      onCreated();
    } catch {
      setError('Could not save shift.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wf-add-shift">
      <h4>Add shift</h4>
      <form className="wf-shift-form" onSubmit={submit}>
        <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
          {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
        </select>
        {teamMembers.length > 0 && (
          <select value={userNodeId} onChange={(e) => setUserNodeId(e.target.value)}>
            <option value="">— any team member —</option>
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        )}
        <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        <span>to</span>
        <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add'}</button>
      </form>
      {error && <p className="wf-error">{error}</p>}
    </div>
  );
}

export default function WorkforcePage({ slug, perms }: Props) {
  const canCreate = perms.has('workforce.employees.create');
  const canDelete = perms.has('workforce.employees.delete');

  const [resources, setResources] = useState<StaffResource[] | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [error, setError] = useState('');

  function load() {
    workforceApi.listStaff()
      .then((r) => setResources(r.resources))
      .catch(() => { setResources([]); setError('Failed to load staff.'); });
    workforceApi.listShifts()
      .then((r) => setShifts(r.shifts))
      .catch(() => setShifts([]));
  }

  useEffect(load, []);

  function deleteShift(id: string) {
    workforceApi.deleteShift(id).then(load).catch(() => setError('Could not remove shift.'));
  }

  if (resources === null) return <div className="wf-page"><p>Loading…</p></div>;

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="schedule" />

      <h1>Staff & Schedule</h1>
      {error && <p className="wf-error">{error}</p>}

      {resources.length === 0 && (
        <p className="wf-empty">No resources found. Add booking resources to see staff here.</p>
      )}

      <div className="wf-resource-list">
        {resources.map((r) => {
          const resourceShifts = shifts.filter((s) => s.resource_id === r.id);

          return (
            <div key={r.id} className="wf-resource-card">
              <h3>
                {r.name}
                {!r.active && <span className="inactive-badge">Inactive</span>}
              </h3>

              {/* Weekly grid — one column per day */}
              <div className="wf-week-grid">
                {DAYS.map((day, dayIdx) => {
                  const dayShifts = resourceShifts.filter((s) => s.weekday === dayIdx);
                  return (
                    <div key={dayIdx} className="wf-day-col">
                      <div className="wf-day-header">{day}</div>
                      {dayShifts.map((s) => (
                        <ShiftPill
                          key={s.id}
                          shift={s}
                          canDelete={canDelete}
                          onDelete={() => deleteShift(s.id)}
                        />
                      ))}
                      {dayShifts.length === 0 && (
                        <span style={{ fontSize: '0.7rem', color: '#cbd5e1' }}>—</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {canCreate && (
                addingFor === r.id
                  ? (
                    <AddShiftForm
                      resourceId={r.id}
                      teamMembers={r.team_members}
                      onCreated={() => { setAddingFor(null); load(); }}
                    />
                  )
                  : (
                    <button
                      style={{ marginTop: 8, fontSize: '0.8rem', background: 'none', border: 'none', cursor: 'pointer', color: '#4f46e5' }}
                      onClick={() => setAddingFor(r.id)}
                    >
                      + Add shift
                    </button>
                  )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
