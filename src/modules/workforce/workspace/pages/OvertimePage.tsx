// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { Link } from 'react-router-dom';
import { workforceApi, type OvertimeEntry, type StaffResource } from '../../shared/api';
import '../../workforce.css';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
};

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

interface WeeklySummaryRow {
  resourceName: string;
  pendingHours: number;
  approvedHours: number;
}

function computeSummary(entries: OvertimeEntry[], staff: StaffResource[]): WeeklySummaryRow[] {
  const map = new Map<string, WeeklySummaryRow>();
  for (const e of entries) {
    if (!map.has(e.resource_id)) {
      const name = staff.find(s => s.id === e.resource_id)?.name ?? e.resource_name ?? e.resource_id;
      map.set(e.resource_id, { resourceName: name, pendingHours: 0, approvedHours: 0 });
    }
    const row = map.get(e.resource_id)!;
    const hrs = Number(e.ot_hours);
    if (e.status === 'pending') row.pendingHours += hrs;
    if (e.status === 'approved') row.approvedHours += hrs;
  }
  return [...map.values()].filter(r => r.pendingHours > 0 || r.approvedHours > 0);
}

export default function OvertimePage({ slug, perms }: Props) {
  const [entries, setEntries] = useState<OvertimeEntry[] | null>(null);
  const [staff, setStaff] = useState<StaffResource[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [error, setError] = useState('');

  // Log OT form state
  const [formResourceId, setFormResourceId] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formHours, setFormHours] = useState('');
  const [formReason, setFormReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const canCreate = perms.has('workforce.employees.create');
  const canHandle = perms.has('workforce.employees.edit');

  useEffect(() => {
    workforceApi.listStaff().then(d => setStaff(d.resources)).catch(() => {});
  }, []);

  async function load() {
    setError('');
    try {
      const params: { resource_id?: string; status?: string } = {};
      if (selectedResourceId) params.resource_id = selectedResourceId;
      if (selectedStatus) params.status = selectedStatus;
      const data = await workforceApi.listOvertime(params);
      setEntries(data.entries);
    } catch {
      setError('Failed to load overtime entries.');
    }
  }

  useEffect(() => { load(); }, [selectedResourceId, selectedStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAction(id: string, action: 'approve' | 'deny') {
    try {
      await workforceApi.handleOvertime(id, action);
      await load();
    } catch {
      setError('Action failed. Please try again.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formResourceId) { setFormError('Select a staff member.'); return; }
    if (!formDate) { setFormError('Date is required.'); return; }
    const hrs = parseFloat(formHours);
    if (!formHours || isNaN(hrs) || hrs <= 0) { setFormError('Hours must be a positive number.'); return; }
    setSubmitting(true);
    setFormError('');
    try {
      await workforceApi.logOvertime({
        resource_id: formResourceId,
        ot_date: formDate,
        ot_hours: hrs,
        reason: formReason || undefined,
      });
      setFormResourceId('');
      setFormDate('');
      setFormHours('');
      setFormReason('');
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to log overtime.';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const summary = entries ? computeSummary(entries, staff) : [];

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="overtime" />

      <div className="wf-ot-layout">
        {/* Filters */}
        <div className="wf-ot-filters">
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

        {/* Error / loading / empty */}
        {error && <div className="wf-error">{error}</div>}
        {entries === null && !error && <div className="wf-loading">Loading overtime entries…</div>}
        {entries !== null && entries.length === 0 && (
          <div className="wf-empty">No overtime entries found.</div>
        )}

        {/* Entries list */}
        {entries !== null && entries.length > 0 && (
          <div className="wf-ot-list">
            {entries.map(e => (
              <div key={e.id} className="wf-ot-card">
                <div className="wf-ot-card-header">
                  <span className="wf-ot-resource">{e.resource_name ?? e.resource_id}</span>
                  <span className="wf-ot-hours">{Number(e.ot_hours)}h OT</span>
                  <span className="wf-ot-date">{e.ot_date}</span>
                  <span className={`wf-status-badge wf-status-${e.status}`}>
                    {STATUS_LABELS[e.status] ?? e.status}
                  </span>
                </div>
                {e.reason && <div className="wf-ot-reason">{e.reason}</div>}
                {canHandle && e.status === 'pending' && (
                  <div className="wf-ot-actions">
                    <button
                      className="wf-btn wf-btn-success"
                      onClick={() => handleAction(e.id, 'approve')}
                    >Approve</button>
                    <button
                      className="wf-btn wf-btn-danger"
                      onClick={() => handleAction(e.id, 'deny')}
                    >Deny</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Weekly summary */}
        {summary.length > 0 && (
          <div className="wf-ot-summary">
            <div className="wf-ot-summary-title">OT Summary (current view)</div>
            <div className="wf-ot-summary-rows">
              {summary.map(row => (
                <div key={row.resourceName} className="wf-ot-summary-row">
                  <span>{row.resourceName}</span>
                  <span>
                    {row.pendingHours > 0 && <span style={{ color: 'var(--text-muted)' }}>{row.pendingHours}h pending </span>}
                    {row.approvedHours > 0 && <span style={{ color: 'var(--success)' }}>{row.approvedHours}h approved</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Log OT form */}
        {canCreate && (
          <section className="wf-ot-form-section">
            <h3 className="wf-section-title">Log Overtime</h3>
            <form onSubmit={handleSubmit} className="wf-ot-form">
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
                <label className="wf-label">Date
                  <input
                    className="wf-input"
                    type="date"
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    required
                  />
                </label>
                <label className="wf-label">Hours
                  <input
                    className="wf-input"
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={formHours}
                    onChange={e => setFormHours(e.target.value)}
                    required
                  />
                </label>
              </div>
              <label className="wf-label">Reason (optional)
                <textarea
                  className="wf-textarea"
                  value={formReason}
                  onChange={e => setFormReason(e.target.value)}
                  rows={2}
                />
              </label>
              <button className="wf-btn wf-btn-primary" type="submit" disabled={submitting}>
                {submitting ? 'Logging…' : 'Log overtime'}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
