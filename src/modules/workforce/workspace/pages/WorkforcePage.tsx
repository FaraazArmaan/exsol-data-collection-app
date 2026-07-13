import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { Link, useParams } from 'react-router-dom';
import {
  workforceApi,
  type ScheduleFinding,
  type SchedulePlanRow,
  type StaffResource,
  type Shift,
} from '../../shared/api';
import { TeamEmployeePicker } from '../components/TeamBridge';
import '../../workforce.css';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function hoursValue(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

function ShiftPill({
  shift,
  staff,
  canDelete,
  onDelete,
}: {
  shift: Shift;
  staff: StaffResource[];
  canDelete: boolean;
  onDelete: () => void;
}) {
  const member = staff.flatMap(s => s.team_members).find(m => m.id === shift.user_node_id);
  return (
    <div className="wf-shift-pill">
      <span>{shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}</span>
      {member && <small>{member.display_name}</small>}
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
          <TeamEmployeePicker
            label="Team user"
            value={userNodeId}
            onChange={setUserNodeId}
            members={teamMembers}
            blankLabel="Any team member"
          />
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
  const [plannerDate, setPlannerDate] = useState(todayIso());
  const [plannerRows, setPlannerRows] = useState<SchedulePlanRow[]>([]);
  const [findings, setFindings] = useState<ScheduleFinding[]>([]);
  const [plannerError, setPlannerError] = useState('');
  const [ruleName, setRuleName] = useState('Standard workday');
  const [maxDailyHours, setMaxDailyHours] = useState('8');
  const [maxWeeklyHours, setMaxWeeklyHours] = useState('40');
  const [breakAfterHours, setBreakAfterHours] = useState('5');
  const [minBreakMinutes, setMinBreakMinutes] = useState('30');
  const [savingRule, setSavingRule] = useState(false);
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

  async function loadPlanner() {
    setPlannerError('');
    try {
      const data = await workforceApi.getSchedulePlanner(plannerDate);
      setPlannerRows(data.plans);
      setFindings(data.findings);
    } catch {
      setPlannerRows([]);
      setFindings([]);
      setPlannerError('Failed to load schedule compliance plan.');
    }
  }

  useEffect(() => { void loadPlanner(); }, [plannerDate]); // eslint-disable-line react-hooks/exhaustive-deps

  function deleteShift(id: string) {
    workforceApi.deleteShift(id).then(() => { load(); void loadPlanner(); }).catch(() => setError('Could not remove shift.'));
  }

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    if (!ruleName.trim()) {
      setPlannerError('Rule name is required.');
      return;
    }
    setSavingRule(true);
    setPlannerError('');
    try {
      await workforceApi.createComplianceRule({
        name: ruleName.trim(),
        max_daily_hours: maxDailyHours ? Number(maxDailyHours) : null,
        max_weekly_hours: maxWeeklyHours ? Number(maxWeeklyHours) : null,
        break_required_after_hours: breakAfterHours ? Number(breakAfterHours) : null,
        min_break_minutes: minBreakMinutes ? Number(minBreakMinutes) : null,
        effective_from: plannerDate,
      });
      await loadPlanner();
    } catch {
      setPlannerError('Could not save compliance rule.');
    } finally {
      setSavingRule(false);
    }
  }

  if (resources === null) return <div className="wf-page"><p>Loading…</p></div>;

  const plannerByResource = new Map(plannerRows.map(row => [row.resource_id, row]));
  const exceededCount = plannerRows.filter(row => row.max_daily_hours_exceeded).length;
  const totalScheduledHours = plannerRows.reduce((sum, row) => sum + hoursValue(row.scheduled_hours), 0);
  const openFindings = findings.filter(f => f.status === 'open');

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="schedule" />

      <div className="wf-page-heading">
        <div>
          <h1>Staff & Schedule</h1>
          <p>Planner-grade schedule checks with Team-linked staff and compliance warnings before the week is published.</p>
        </div>
        <label className="wf-label wf-date-filter">Planner date
          <input className="wf-input" type="date" value={plannerDate} onChange={e => setPlannerDate(e.target.value)} />
        </label>
      </div>
      {error && <p className="wf-error">{error}</p>}
      {plannerError && <p className="wf-error">{plannerError}</p>}

      <section className="wf-planner-grid">
        <div className="wf-planner-panel">
          <div className="wf-section-title">Compliance Planner</div>
          <div className="wf-planner-kpis">
            <div><strong>{plannerRows.length}</strong><span>Covered resources</span></div>
            <div><strong>{totalScheduledHours.toFixed(1)}</strong><span>Scheduled hours</span></div>
            <div><strong>{exceededCount}</strong><span>Daily limit risks</span></div>
            <div><strong>{openFindings.length}</strong><span>Open findings</span></div>
          </div>
          {plannerRows.length > 0 ? (
            <div className="wf-planner-list">
              {plannerRows.map(row => (
                <div key={row.resource_id} className={row.max_daily_hours_exceeded ? 'wf-planner-row danger' : 'wf-planner-row'}>
                  <span>{row.resource_name}</span>
                  <span>{hoursValue(row.scheduled_hours).toFixed(1)}h / {row.max_daily_hours ?? 'no'} daily cap</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="wf-empty">No scheduled shifts for this planner date.</div>
          )}
          {openFindings.length > 0 && (
            <div className="wf-planner-findings">
              {openFindings.map(f => (
                <span key={f.id} className={`wf-finding ${f.severity}`}>{f.finding_type}</span>
              ))}
            </div>
          )}
        </div>

        {perms.has('workforce.employees.edit') && (
          <form className="wf-planner-panel" onSubmit={createRule}>
            <div className="wf-section-title">Active Rule Template</div>
            <div className="wf-rule-form-grid">
              <label className="wf-label">Rule name
                <input className="wf-input" value={ruleName} onChange={e => setRuleName(e.target.value)} required />
              </label>
              <label className="wf-label">Daily max
                <input className="wf-input" type="number" min="0" step="0.25" value={maxDailyHours} onChange={e => setMaxDailyHours(e.target.value)} />
              </label>
              <label className="wf-label">Weekly max
                <input className="wf-input" type="number" min="0" step="0.25" value={maxWeeklyHours} onChange={e => setMaxWeeklyHours(e.target.value)} />
              </label>
              <label className="wf-label">Break after hours
                <input className="wf-input" type="number" min="0" step="0.25" value={breakAfterHours} onChange={e => setBreakAfterHours(e.target.value)} />
              </label>
              <label className="wf-label">Minimum break minutes
                <input className="wf-input" type="number" min="0" step="5" value={minBreakMinutes} onChange={e => setMinBreakMinutes(e.target.value)} />
              </label>
              <div className="wf-rule-action">
                <button className="wf-btn wf-btn-primary" type="submit" disabled={savingRule}>{savingRule ? 'Saving...' : 'Save rule'}</button>
              </div>
            </div>
          </form>
        )}
      </section>

      {resources.length === 0 && (
        <p className="wf-empty">No resources found. Add booking resources to see staff here.</p>
      )}

      <div className="wf-resource-list">
        {resources.map((r) => {
          const resourceShifts = shifts.filter((s) => s.resource_id === r.id);
          const plannerRow = plannerByResource.get(r.id);

          return (
            <div key={r.id} className="wf-resource-card">
              <h3>
                {r.name}
                {!r.active && <span className="inactive-badge">Inactive</span>}
                {plannerRow?.max_daily_hours_exceeded && <span className="inactive-badge danger">Hours risk</span>}
              </h3>
              {plannerRow && (
                <div className="wf-resource-meta">
                  {hoursValue(plannerRow.scheduled_hours).toFixed(1)}h scheduled on {plannerDate}
                  {plannerRow.rule_name && <span> - {plannerRow.rule_name}</span>}
                </div>
              )}

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
                          staff={resources}
                          canDelete={canDelete}
                          onDelete={() => deleteShift(s.id)}
                        />
                      ))}
                      {dayShifts.length === 0 && (
                        <span className="wf-day-empty">-</span>
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
                      className="wf-inline-action"
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
