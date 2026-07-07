// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { workforceApi, type LeaveRequest, type LeaveBalance, type StaffResource } from '../../shared/api';
import '../../workforce.css';

const LEAVE_TYPES = ['annual', 'sick', 'personal', 'unpaid'] as const;
type LeaveType = (typeof LEAVE_TYPES)[number];

const LEAVE_LABELS: Record<string, string> = {
  annual: 'Annual',
  sick: 'Sick',
  personal: 'Personal',
  unpaid: 'Unpaid',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
};

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

export default function LeaveRequestsPage({ slug, perms }: Props) {
  const [requests, setRequests] = useState<LeaveRequest[] | null>(null);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [staff, setStaff] = useState<StaffResource[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [error, setError] = useState('');

  // Create form state
  const [formResourceId, setFormResourceId] = useState('');
  const [formLeaveType, setFormLeaveType] = useState<LeaveType>('annual');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const canCreate = perms.has('workforce.leave.create');
  const canHandle = perms.has('workforce.leave.edit');

  useEffect(() => {
    workforceApi.listStaff().then(d => setStaff(d.resources)).catch(() => {});
  }, []);

  async function load() {
    setError('');
    try {
      const params: { resource_id?: string; status?: string } = {};
      if (selectedResourceId) params.resource_id = selectedResourceId;
      if (selectedStatus) params.status = selectedStatus;
      const data = await workforceApi.listLeaves(params);
      setRequests(data.requests);
      setBalances(data.balances);
    } catch {
      setError('Failed to load leave requests.');
    }
  }

  useEffect(() => { load(); }, [selectedResourceId, selectedStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAction(id: string, action: 'approve' | 'deny') {
    try {
      await workforceApi.handleLeave(id, action);
      await load();
    } catch {
      setError('Action failed. Please try again.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formResourceId) { setFormError('Select a staff member.'); return; }
    if (!formStartDate || !formEndDate) { setFormError('Start and end dates are required.'); return; }
    setSubmitting(true);
    setFormError('');
    try {
      await workforceApi.createLeave({
        resource_id: formResourceId,
        leave_type: formLeaveType,
        start_date: formStartDate,
        end_date: formEndDate,
        notes: formNotes || undefined,
      });
      setFormResourceId('');
      setFormLeaveType('annual');
      setFormStartDate('');
      setFormEndDate('');
      setFormNotes('');
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit leave request.';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const currentBalances = selectedResourceId ? balances : [];

  return (
    <div className="wf-page">
      {/* Tab nav */}
      <nav className="wf-tabs">
        <Link className="wf-tab-link" to={`/c/${slug}/workforce`}>Staff &amp; Schedule</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/timesheets`}>Timesheets</Link>
        <span className="wf-tab-link wf-tab-active">Leave</span>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/punching`}>Punching</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/overtime`}>Overtime</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/swaps`}>Swaps</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/payroll`}>Payroll</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/training`}>Training</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/assets`}>Assets</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/employees`}>Employees</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/projects`}>Projects</Link>
      </nav>

      <div className="wf-leave-layout">
        {/* Filters */}
        <div className="wf-leave-filters">
          <select
            className="wf-select"
            value={selectedResourceId}
            onChange={e => setSelectedResourceId(e.target.value)}
          >
            <option value="">All staff</option>
            {staff.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            className="wf-select"
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
          </select>
        </div>

        {/* Leave balances (only when a resource is selected) */}
        {currentBalances.length > 0 && (
          <div className="wf-leave-balances">
            {currentBalances.map(b => (
              <div key={b.id} className="wf-leave-balance-chip">
                <span className="wf-leave-balance-type">{LEAVE_LABELS[b.leave_type] ?? b.leave_type}</span>
                <span className="wf-leave-balance-days">{b.balance_days} days</span>
              </div>
            ))}
          </div>
        )}

        {/* Requests list */}
        {error && <div className="wf-error">{error}</div>}

        {requests === null && !error && (
          <div className="wf-loading">Loading leave requests…</div>
        )}

        {requests !== null && requests.length === 0 && (
          <div className="wf-empty">No leave requests found.</div>
        )}

        {requests !== null && requests.length > 0 && (
          <div className="wf-leave-list">
            {requests.map(r => (
              <div key={r.id} className="wf-leave-card">
                <div className="wf-leave-card-header">
                  <span className="wf-leave-resource">{r.resource_name ?? r.resource_id}</span>
                  <span className={`wf-leave-type-badge wf-leave-type-${r.leave_type}`}>
                    {LEAVE_LABELS[r.leave_type] ?? r.leave_type}
                  </span>
                  <span className={`wf-status-badge wf-status-${r.status}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </div>
                <div className="wf-leave-dates">
                  {r.start_date} → {r.end_date}
                </div>
                {r.notes && <div className="wf-leave-notes">{r.notes}</div>}
                {canHandle && r.status === 'pending' && (
                  <div className="wf-leave-actions">
                    <button
                      className="wf-btn wf-btn-success"
                      onClick={() => handleAction(r.id, 'approve')}
                    >Approve</button>
                    <button
                      className="wf-btn wf-btn-danger"
                      onClick={() => handleAction(r.id, 'deny')}
                    >Deny</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Create form */}
        {canCreate && (
          <section className="wf-leave-form-section">
            <h3 className="wf-section-title">Apply for Leave</h3>
            <form onSubmit={handleSubmit} className="wf-leave-form">
              {formError && <div className="wf-error">{formError}</div>}
              <div className="wf-form-row">
                <label className="wf-label">Staff member
                  <select
                    className="wf-select"
                    value={formResourceId}
                    onChange={e => setFormResourceId(e.target.value)}
                    required
                  >
                    <option value="">Select staff…</option>
                    {staff.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
                <label className="wf-label">Type
                  <select
                    className="wf-select"
                    value={formLeaveType}
                    onChange={e => setFormLeaveType(e.target.value as LeaveType)}
                  >
                    {LEAVE_TYPES.map(t => (
                      <option key={t} value={t}>{LEAVE_LABELS[t]}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="wf-form-row">
                <label className="wf-label">Start date
                  <input className="wf-input" type="date" value={formStartDate} onChange={e => setFormStartDate(e.target.value)} required />
                </label>
                <label className="wf-label">End date
                  <input className="wf-input" type="date" value={formEndDate} onChange={e => setFormEndDate(e.target.value)} required />
                </label>
              </div>
              <label className="wf-label">Notes (optional)
                <textarea className="wf-textarea" value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} />
              </label>
              <button className="wf-btn wf-btn-primary" type="submit" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit request'}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
