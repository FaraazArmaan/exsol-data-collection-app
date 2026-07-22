import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import { useNavItems } from '../nav/useNavItems';
import { formatWorkforceTime } from '../../workforce/shared/time';
import {
  workforceMeActOnShiftSwap,
  workforceMeAcknowledgeScheduleNotice,
  workforceMeCancelLeaveRequest,
  workforceMeCancelTimeCorrection,
  workforceMeClockIn,
  workforceMeClockOut,
  workforceMeCreateLeaveRequest,
  workforceMeDashboard,
  workforceMeEndBreak,
  workforceMeOfferShiftSwap,
  workforceMeRequestTimeCorrection,
  workforceMeRequestAttendanceRecovery,
  workforceMeStartBreak,
  workforceMeTimeStatus,
  type WorkforceMeDashboard,
  type WorkforceMeTimeStatus,
} from '../api';

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card tile">
      <div className="tile-stat-label">{label}</div>
      <div className="tile-stat-value">{value}</div>
    </div>
  );
}

function StubTile({ title, description }: { title: string; description: string }) {
  return (
    <div className="card tile tile-disabled" title="Coming soon" aria-disabled="true">
      <div className="tile-title">{title}</div>
      <div className="tile-sub">{description}</div>
      <div className="tile-disabled-badge">Coming soon</div>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return 'No date';
  return new Date(`${value}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function money(amount: number | string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currency} ${amount}`;
  return new Intl.NumberFormat([], { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

function weekdayName(day: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] ?? `Day ${day}`;
}

type BrowserLocationError = Error & { code: 'permission_denied' | 'position_unavailable' | 'location_timeout' };

function browserLocation(): Promise<{ latitude: number; longitude: number; accuracy_meters: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location access is not available in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_meters: pos.coords.accuracy,
      }),
      (error) => {
        const code = error.code === error.PERMISSION_DENIED
          ? 'permission_denied'
          : error.code === error.TIMEOUT ? 'location_timeout' : 'position_unavailable';
        const message = code === 'permission_denied'
          ? 'Location access was not allowed. You can request a supervisor review instead.'
          : code === 'location_timeout'
            ? 'Location capture timed out. You can try again or request a supervisor review.'
            : 'Your location is unavailable. You can try again or request a supervisor review.';
        reject(Object.assign(new Error(message), { code }));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

function WorkforceTimeCard({ enabled, timeZone }: { enabled: boolean; timeZone: string | null | undefined }) {
  const [status, setStatus] = useState<WorkforceMeTimeStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [recoveryFailure, setRecoveryFailure] = useState('');
  const [recoveryReason, setRecoveryReason] = useState('');
  const [recoveryLocation, setRecoveryLocation] = useState<{ latitude: number; longitude: number; accuracy_meters: number } | null>(null);

  async function load() {
    if (!enabled) return;
    setLoading(true);
    const res = await workforceMeTimeStatus();
    if (res.ok) {
      setStatus(res.data);
      setMessage('');
    } else if (res.error.code === 'employee_profile_not_linked') {
      setStatus(null);
      setMessage('Workforce setup is pending. Ask a manager to create your employee profile before using attendance.');
    } else {
      setMessage(res.error.message || res.error.code);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;

  const openPunch = status?.open_punch ?? null;
  const openBreak = status?.open_break ?? null;
  const state = openBreak ? 'On break' : openPunch ? 'Clocked in' : 'Not clocked in';

  async function act(action: 'clock-in' | 'clock-out' | 'start-break' | 'end-break') {
    setBusy(action);
    setMessage('');
    let res;
    try {
      const idempotencyKey = crypto.randomUUID();
      if (action === 'clock-in') {
        const location = await browserLocation();
        setRecoveryLocation(location);
        res = await workforceMeClockIn(location, idempotencyKey);
      } else if (action === 'clock-out') {
        res = await workforceMeClockOut(idempotencyKey);
      } else if (action === 'start-break') {
        res = await workforceMeStartBreak(idempotencyKey);
      } else {
        res = await workforceMeEndBreak(idempotencyKey);
      }
      if (!res.ok) {
        const code = res.error.code;
        if (action === 'clock-in' && ['outside_geofence', 'location_accuracy_too_low', 'geofence_unconfigured', 'network_error'].includes(code)) {
          setRecoveryFailure(code);
        }
        setMessage(
          code === 'outside_geofence' ? 'You are outside an approved work location.'
            : code === 'location_accuracy_too_low' ? 'Location accuracy is too low. Move near the worksite and try again.'
              : code === 'geofence_unconfigured' ? 'No approved work location is assigned to your profile.'
                : res.error.message || code,
        );
        return;
      }
      if (action === 'clock-in') {
        setRecoveryFailure('');
        setRecoveryReason('');
      }
      await load();
    } catch (err) {
      const locationError = err as BrowserLocationError;
      if (action === 'clock-in' && locationError.code) setRecoveryFailure(locationError.code);
      setMessage(err instanceof Error ? err.message : 'Unable to complete time action.');
    } finally {
      setBusy('');
    }
  }

  async function submitRecovery(e: FormEvent) {
    e.preventDefault();
    if (!recoveryFailure) return;
    setBusy('attendance-recovery');
    setMessage('');
    const res = await workforceMeRequestAttendanceRecovery({
      failure_code: recoveryFailure,
      reason: recoveryReason,
      request_key: crypto.randomUUID(),
      ...(recoveryLocation ?? {}),
    });
    if (res.ok) {
      setRecoveryReason('');
      setMessage('Attendance recovery request submitted for supervisor review.');
      await load();
    } else {
      setMessage(res.error.message || res.error.code);
    }
    setBusy('');
  }

  return (
    <section className="dash-time-card card">
      <div className="dash-time-head">
        <div>
          <h2 className="section-title">Today&apos;s time</h2>
          <p className="muted">
            {loading ? 'Loading...' : status ? `${status.employee.legal_name} - ${status.employee.resource_name}` : 'Employee profile required'}
          </p>
        </div>
        <span className={`dash-time-state ${openPunch ? 'is-active' : ''}`}>{state}</span>
      </div>

      {status && (
        <div className="dash-time-body">
          <div className="dash-time-metric">
            <span>Clock in</span>
            <strong>{openPunch ? formatWorkforceTime(openPunch.punched_in_at, timeZone) : '--'}</strong>
          </div>
          <div className="dash-time-metric">
            <span>Break</span>
            <strong>{openBreak ? formatWorkforceTime(openBreak.started_at, timeZone) : 'None open'}</strong>
          </div>
          <div className="dash-time-metric">
            <span>Worksites</span>
            <strong>{status.locations.length}</strong>
          </div>
        </div>
      )}

      {message && <div className="dash-time-message">{message}</div>}

      {status && (
        <div className="dash-time-actions">
          {!openPunch && (
            <button className="btn btn-primary" disabled={!!busy || status.locations.length === 0} onClick={() => void act('clock-in')}>
              {busy === 'clock-in' ? 'Checking...' : 'Clock in'}
            </button>
          )}
          {openPunch && !openBreak && (
            <>
              <button className="btn btn-secondary" disabled={!!busy} onClick={() => void act('start-break')}>
                {busy === 'start-break' ? 'Starting...' : 'Start break'}
              </button>
              <button className="btn btn-primary" disabled={!!busy} onClick={() => void act('clock-out')}>
                {busy === 'clock-out' ? 'Clocking out...' : 'Clock out'}
              </button>
            </>
          )}
          {openBreak && (
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void act('end-break')}>
              {busy === 'end-break' ? 'Ending...' : 'End break'}
            </button>
          )}
        </div>
      )}

      {status && recoveryFailure && !openPunch && (
        <form className="dash-mini-form dash-attendance-recovery" onSubmit={(e) => void submitRecovery(e)}>
          <div className="dash-card-head">
            <h3>Need help clocking in?</h3>
            <span>Supervisor review</span>
          </div>
          <p className="muted">Your clock-in remains protected by the worksite rule. Tell your supervisor what happened; the request includes the captured location result when available.</p>
          <label>
            What happened?
            <textarea required minLength={3} rows={2} value={recoveryReason} onChange={(e) => setRecoveryReason(e.target.value)} />
          </label>
          <button className="btn btn-secondary" disabled={busy === 'attendance-recovery'}>
            {busy === 'attendance-recovery' ? 'Submitting...' : 'Request supervisor review'}
          </button>
        </form>
      )}

      {status && status.recovery_requests.length > 0 && (
        <div className="dash-list dash-attendance-recovery-list">
          {status.recovery_requests.slice(0, 2).map((request) => (
            <div key={request.id} className="dash-list-row">
              <div>
                <strong>Clock-in recovery</strong>
                <span>{request.resolution_note || request.failure_code.replaceAll('_', ' ')}</span>
              </div>
              <span className="dash-status">{request.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function WorkforceSelfService({ enabled }: { enabled: boolean }) {
  const [dashboard, setDashboard] = useState<WorkforceMeDashboard | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [leave, setLeave] = useState({ leave_type: 'annual', start_date: '', end_date: '', notes: '' });
  const [swap, setSwap] = useState({ shift_id: '', offering_date: '', notes: '' });
  const [correction, setCorrection] = useState({ correction_type: 'missed_clock_in', requested_at: '', notes: '' });

  async function load() {
    if (!enabled) return;
    setLoading(true);
    const res = await workforceMeDashboard();
    if (res.ok) {
      setDashboard(res.data);
      setMessage('');
    } else if (res.error.code === 'employee_profile_not_linked') {
      setDashboard(null);
    } else {
      setMessage(res.error.message || res.error.code);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;
  if (loading && !dashboard) return <section className="dash-workforce-grid"><div className="card">Loading workforce details...</div></section>;
  if (!dashboard) return null;

  async function submitLeave(e: FormEvent) {
    e.preventDefault();
    setBusy('leave');
    const res = await workforceMeCreateLeaveRequest(leave);
    if (res.ok) {
      setLeave({ leave_type: 'annual', start_date: '', end_date: '', notes: '' });
      await load();
    } else {
      setMessage(res.error.message || res.error.code);
    }
    setBusy('');
  }

  async function cancelLeave(id: string) {
    setBusy(id);
    const res = await workforceMeCancelLeaveRequest(id);
    if (res.ok) await load();
    else setMessage(res.error.message || res.error.code);
    setBusy('');
  }

  async function submitSwap(e: FormEvent) {
    e.preventDefault();
    const shiftId = swap.shift_id || dashboard?.shifts[0]?.id || '';
    if (!shiftId) {
      setMessage('No shift is available to offer.');
      return;
    }
    setBusy('swap');
    const res = await workforceMeOfferShiftSwap({ ...swap, shift_id: shiftId });
    if (res.ok) {
      setSwap({ shift_id: '', offering_date: '', notes: '' });
      await load();
    } else {
      setMessage(res.error.message || res.error.code);
    }
    setBusy('');
  }

  async function actOnSwap(id: string, action: 'claim' | 'cancel') {
    setBusy(id);
    const res = await workforceMeActOnShiftSwap(id, action);
    if (res.ok) await load();
    else setMessage(res.error.message || res.error.code);
    setBusy('');
  }

  async function submitCorrection(e: FormEvent) {
    e.preventDefault();
    setBusy('correction');
    const res = await workforceMeRequestTimeCorrection({
      correction_type: correction.correction_type,
      new_values: correction.requested_at ? { requested_at: correction.requested_at } : {},
      notes: correction.notes,
    });
    if (res.ok) {
      setCorrection({ correction_type: 'missed_clock_in', requested_at: '', notes: '' });
      await load();
    } else {
      setMessage(res.error.message || res.error.code);
    }
    setBusy('');
  }

  async function cancelCorrection(id: string) {
    setBusy(id);
    const res = await workforceMeCancelTimeCorrection(id);
    if (res.ok) await load();
    else setMessage(res.error.message || res.error.code);
    setBusy('');
  }

  async function acknowledgeSchedule(noticeId: string) {
    setBusy(noticeId);
    const res = await workforceMeAcknowledgeScheduleNotice(noticeId);
    if (res.ok) await load();
    else setMessage(res.error.message || res.error.code);
    setBusy('');
  }

  return (
    <section className="dash-workforce">
      <div className="dash-workforce-head">
        <h2 className="section-title">Workforce</h2>
        <span>{dashboard.employee.legal_name}</span>
      </div>
      {message && <div className="dash-time-message">{message}</div>}

      <div className="dash-workforce-grid">
        <div className="card dash-workforce-card">
          <div className="dash-card-head">
            <h3>Leave</h3>
            <span>{dashboard.leave_requests.filter((r) => r.status === 'pending').length} pending</span>
          </div>
          <div className="dash-chip-row">
            {dashboard.leave_balances.map((balance) => (
              <span key={balance.leave_type} className="dash-chip">
                {balance.leave_type}: {Number(balance.balance_days).toFixed(1)}
              </span>
            ))}
            {dashboard.leave_balances.length === 0 && <span className="muted">No balances</span>}
          </div>
          <form className="dash-mini-form" onSubmit={(e) => void submitLeave(e)}>
            <label>
              Type
              <select value={leave.leave_type} onChange={(e) => setLeave({ ...leave, leave_type: e.target.value })}>
                <option value="annual">Annual</option>
                <option value="sick">Sick</option>
                <option value="personal">Personal</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </label>
            <div className="dash-form-row">
              <label>
                Start
                <input required type="date" value={leave.start_date} onChange={(e) => setLeave({ ...leave, start_date: e.target.value })} />
              </label>
              <label>
                End
                <input required type="date" value={leave.end_date} onChange={(e) => setLeave({ ...leave, end_date: e.target.value })} />
              </label>
            </div>
            <label>
              Notes
              <textarea rows={2} value={leave.notes} onChange={(e) => setLeave({ ...leave, notes: e.target.value })} />
            </label>
            <button className="btn btn-primary" disabled={busy === 'leave'}>{busy === 'leave' ? 'Requesting...' : 'Request leave'}</button>
          </form>
          <div className="dash-list">
            {dashboard.leave_requests.map((request) => (
              <div key={request.id} className="dash-list-row">
                <div>
                  <strong>{request.leave_type}</strong>
                  <span>{formatDate(request.start_date)} - {formatDate(request.end_date)}</span>
                </div>
                {request.status === 'pending' ? (
                  <button className="btn btn-ghost" disabled={busy === request.id} onClick={() => void cancelLeave(request.id)}>Cancel</button>
                ) : (
                  <span className="dash-status">{request.status}</span>
                )}
              </div>
            ))}
            {dashboard.leave_requests.length === 0 && <p className="muted">No leave requests</p>}
          </div>
        </div>

        <div className="card dash-workforce-card">
          <div className="dash-card-head">
            <h3>Shift swaps</h3>
            <span>{dashboard.swaps.filter((s) => s.status === 'open').length} open</span>
          </div>
          <form className="dash-mini-form" onSubmit={(e) => void submitSwap(e)}>
            <label>
              Shift
              <select value={swap.shift_id} onChange={(e) => setSwap({ ...swap, shift_id: e.target.value })}>
                <option value="">Select shift</option>
                {dashboard.shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {weekdayName(shift.weekday)} {shift.start_time.slice(0, 5)}-{shift.end_time.slice(0, 5)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input required type="date" value={swap.offering_date} onChange={(e) => setSwap({ ...swap, offering_date: e.target.value })} />
            </label>
            <label>
              Notes
              <textarea rows={2} value={swap.notes} onChange={(e) => setSwap({ ...swap, notes: e.target.value })} />
            </label>
            <button className="btn btn-primary" disabled={busy === 'swap' || dashboard.shifts.length === 0}>
              {busy === 'swap' ? 'Offering...' : 'Offer shift'}
            </button>
          </form>
          <div className="dash-list">
            {dashboard.swaps.map((item) => (
              <div key={item.id} className="dash-list-row">
                <div>
                  <strong>{formatDate(item.offering_date)}</strong>
                  <span>{item.offering_resource_name ?? 'Employee'} - {item.status}</span>
                </div>
                {item.is_mine || item.claimed_by_me ? (
                  <button className="btn btn-ghost" disabled={busy === item.id} onClick={() => void actOnSwap(item.id, 'cancel')}>Cancel</button>
                ) : item.status === 'open' ? (
                  <button className="btn btn-secondary" disabled={busy === item.id} onClick={() => void actOnSwap(item.id, 'claim')}>Claim</button>
                ) : (
                  <span className="dash-status">{item.status}</span>
                )}
              </div>
            ))}
            {dashboard.swaps.length === 0 && <p className="muted">No shift swaps</p>}
          </div>
        </div>

        <div className="card dash-workforce-card">
          <div className="dash-card-head">
            <h3>Pay and records</h3>
            <span>{dashboard.payslips.length} payslips</span>
          </div>
          <div className="dash-list">
            {dashboard.payslips.map((payslip) => (
              <div key={payslip.id} className="dash-list-row">
                <div>
                  <strong>{money(payslip.net_amount, payslip.currency)}</strong>
                  <span>{formatDate(payslip.period_start)} - {formatDate(payslip.period_end)}</span>
                </div>
                <span className="dash-status">{payslip.status}</span>
              </div>
            ))}
            {dashboard.payslips.length === 0 && <p className="muted">No payslips</p>}
          </div>
          <form className="dash-mini-form" onSubmit={(e) => void submitCorrection(e)}>
            <label>
              Correction
              <select value={correction.correction_type} onChange={(e) => setCorrection({ ...correction, correction_type: e.target.value })}>
                <option value="missed_clock_in">Missed clock in</option>
                <option value="missed_clock_out">Missed clock out</option>
                <option value="edit_time">Edit time</option>
                <option value="delete_punch">Delete punch</option>
              </select>
            </label>
            <label>
              Time
              <input type="datetime-local" value={correction.requested_at} onChange={(e) => setCorrection({ ...correction, requested_at: e.target.value })} />
            </label>
            <label>
              Notes
              <textarea rows={2} value={correction.notes} onChange={(e) => setCorrection({ ...correction, notes: e.target.value })} />
            </label>
            <button className="btn btn-secondary" disabled={busy === 'correction'}>
              {busy === 'correction' ? 'Sending...' : 'Request correction'}
            </button>
          </form>
          <div className="dash-list">
            {dashboard.corrections.map((item) => (
              <div key={item.id} className="dash-list-row">
                <div>
                  <strong>{item.correction_type}</strong>
                  <span>{item.resolution_note || formatDate(item.created_at.slice(0, 10))}</span>
                </div>
                {item.status === 'pending' ? (
                  <button className="btn btn-ghost" disabled={busy === item.id} onClick={() => void cancelCorrection(item.id)}>Cancel</button>
                ) : (
                  <span className="dash-status">{item.status}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card dash-workforce-card">
          <div className="dash-card-head">
            <h3>Published schedule</h3>
            <span>{dashboard.published_schedule.length} upcoming</span>
          </div>
          <div className="dash-list">
            {dashboard.published_schedule.map((shift) => (
              <div key={`${shift.notice_id}:${shift.shift_date}:${shift.start_time}`} className="dash-list-row">
                <div>
                  <strong>{formatDate(shift.shift_date)}</strong>
                  <span>{shift.start_time}-{shift.end_time} · {shift.resource_name}</span>
                </div>
                {shift.acknowledgement_required && !shift.acknowledged_at ? (
                  <button className="btn btn-secondary" disabled={busy === shift.notice_id} onClick={() => void acknowledgeSchedule(shift.notice_id)}>Acknowledge</button>
                ) : (
                  <span className="dash-status">{shift.acknowledged_at ? 'acknowledged' : 'published'}</span>
                )}
              </div>
            ))}
            {dashboard.published_schedule.length === 0 && <p className="muted">No published shifts are scheduled yet.</p>}
          </div>
        </div>

        <div className="card dash-workforce-card">
          <div className="dash-card-head">
            <h3>Training and assets</h3>
            <span>{dashboard.compliance_tasks.length} tasks</span>
          </div>
          <div className="dash-list">
            {dashboard.compliance_tasks.map((task) => (
              <div key={task.id} className="dash-list-row">
                <div>
                  <strong>{task.requirement_name ?? 'Compliance task'}</strong>
                  <span>{task.due_date ? `Due ${formatDate(task.due_date)}` : task.status}</span>
                </div>
                <span className="dash-status">{task.status}</span>
              </div>
            ))}
            {dashboard.training.map((course) => (
              <div key={course.course_id} className="dash-list-row">
                <div>
                  <strong>{course.name}</strong>
                  <span>{course.completed_at ? `Completed ${formatDate(course.completed_at)}` : 'Required'}</span>
                </div>
                <span className="dash-status">{course.completed_at ? 'done' : 'open'}</span>
              </div>
            ))}
            {dashboard.assets.map((asset) => (
              <div key={asset.assignment_id} className="dash-list-row">
                <div>
                  <strong>{asset.name}</strong>
                  <span>{asset.serial_number ?? asset.condition}</span>
                </div>
                <span className="dash-status">assigned</span>
              </div>
            ))}
            {dashboard.compliance_tasks.length + dashboard.training.length + dashboard.assets.length === 0 && (
              <p className="muted">No training, asset, or compliance items</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function UserDashboardHome() {
  const { slug } = useParams<{ slug: string }>();
  const { user, client, enabledModules } = useUserAuth();
  const navItems = useNavItems();

  if (!user || !client || !slug) return null;

  const isOwner = user.level_number == null || user.level_number === 1;
  const workforceEnabled = enabledModules.some((m) => m.key === 'workforce');

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Welcome back, {user.display_name}</h1>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          {client.name} - {user.role.label}
        </p>
      </header>

      <section className="tile-row">
        <StatTile label="Role" value={user.role.label} />
        <StatTile label="Modules available" value={navItems.length} />
        <StatTile label="Workspace" value={client.name} />
      </section>

      <WorkforceTimeCard enabled={workforceEnabled} timeZone={client.timezone} />
      <WorkforceSelfService enabled={workforceEnabled} />

      <section>
        <h2 className="section-title">Quick actions</h2>
        <div className="tile-row">
          {navItems.map((item) => (
            <Link key={item.moduleKey} to={item.href} className="card tile tile-link">
              <div className="tile-title">{item.label}</div>
              <div className="tile-sub">Open module</div>
            </Link>
          ))}
          {isOwner && (
            <>
              <Link to={`/c/${slug}/team`} className="card tile tile-link">
                <div className="tile-title">Manage team</div>
                <div className="tile-sub">Add, edit, and remove users in your workspace.</div>
              </Link>
              <StubTile title="Settings" description="Configure workspace preferences and integrations." />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
