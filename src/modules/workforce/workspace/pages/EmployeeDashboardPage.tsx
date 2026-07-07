// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { workforceApi, type EmployeeProfile, type StaffResource } from '../../shared/api';
import '../../workforce.css';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

const CONDITION_LABELS: Record<string, string> = {
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  retired: 'Retired',
};

const LEAVE_LABELS: Record<string, string> = {
  annual: 'Annual',
  sick: 'Sick',
  personal: 'Personal',
  unpaid: 'Unpaid',
};

export default function EmployeeDashboardPage({ slug }: Props) {
  const [staff, setStaff] = useState<StaffResource[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    workforceApi.listStaff().then(d => setStaff(d.resources)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedResourceId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    setError('');
    workforceApi
      .getEmployeeProfile(selectedResourceId)
      .then(data => {
        setProfile(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load employee profile.');
        setLoading(false);
      });
  }, [selectedResourceId]);

  return (
    <div className="wf-page">
      {/* Tab nav */}
      <nav className="wf-tabs">
        <Link className="wf-tab-link" to={`/c/${slug}/workforce`}>Staff &amp; Schedule</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/timesheets`}>Timesheets</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/leave`}>Leave</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/punching`}>Punching</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/overtime`}>Overtime</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/swaps`}>Swaps</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/payroll`}>Payroll</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/training`}>Training</Link>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/assets`}>Assets</Link>
        <span className="wf-tab-link wf-tab-active">Employees</span>
        <Link className="wf-tab-link" to={`/c/${slug}/workforce/projects`}>Projects</Link>
      </nav>

      <div className="wf-emp-layout">
        {/* Resource selector */}
        <div className="wf-emp-select-row">
          <span className="wf-emp-select-label">Staff member:</span>
          <select
            className="wf-select"
            value={selectedResourceId}
            onChange={e => setSelectedResourceId(e.target.value)}
          >
            <option value="">Select a staff member…</option>
            {staff.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* States */}
        {!selectedResourceId && (
          <div className="wf-emp-empty">Select a staff member to view their profile.</div>
        )}
        {selectedResourceId && loading && (
          <div className="wf-emp-loading">Loading profile…</div>
        )}
        {selectedResourceId && !loading && error && (
          <div className="wf-error">{error}</div>
        )}

        {/* Profile cards */}
        {!loading && !error && profile && (
          <div className="wf-emp-grid">
            {/* This Week card */}
            <div className="wf-emp-card">
              <div className="wf-emp-card-title">This Week</div>
              <div className="wf-emp-stats-grid">
                <div className="wf-emp-stat">
                  <span className="wf-emp-stat-value">{profile.this_week.shifts}</span>
                  <span className="wf-emp-stat-label">Shifts</span>
                </div>
                <div className="wf-emp-stat">
                  <span className="wf-emp-stat-value">{profile.this_week.punches}</span>
                  <span className="wf-emp-stat-label">Punches</span>
                </div>
                <div className="wf-emp-stat">
                  <span className="wf-emp-stat-value">{profile.this_week.hours_worked.toFixed(1)}</span>
                  <span className="wf-emp-stat-label">Hours Worked</span>
                </div>
                <div className="wf-emp-stat">
                  <span className="wf-emp-stat-value">{profile.this_week.ot_hours.toFixed(1)}</span>
                  <span className="wf-emp-stat-label">OT Hours</span>
                </div>
                <div className="wf-emp-stat">
                  {profile.this_week.on_leave ? (
                    <span className="wf-emp-on-leave">On Leave</span>
                  ) : (
                    <span className="wf-emp-stat-value" style={{ fontSize: '1rem' }}>—</span>
                  )}
                  <span className="wf-emp-stat-label">Leave Status</span>
                </div>
              </div>
            </div>

            {/* Leave card */}
            <div className="wf-emp-card">
              <div className="wf-emp-card-title">Leave</div>
              <div className="wf-emp-stats-grid">
                <div className="wf-emp-stat">
                  <span className="wf-emp-stat-value">{profile.leave.pending}</span>
                  <span className="wf-emp-stat-label">Pending</span>
                </div>
                <div className="wf-emp-stat">
                  <span className="wf-emp-stat-value">{profile.leave.approved_this_month}</span>
                  <span className="wf-emp-stat-label">Approved This Month</span>
                </div>
              </div>
              {profile.leave.balances.length > 0 && (
                <div className="wf-emp-balance-row">
                  {profile.leave.balances.map(b => (
                    <span key={b.leave_type} className="wf-emp-balance-chip">
                      {LEAVE_LABELS[b.leave_type] ?? b.leave_type}: {b.balance_days}d
                    </span>
                  ))}
                </div>
              )}
              {profile.leave.balances.length === 0 && (
                <span className="wf-emp-stat-label">No balances recorded.</span>
              )}
            </div>

            {/* Training card */}
            <div className="wf-emp-card">
              <div className="wf-emp-card-title">Training</div>
              <div className="wf-emp-stats-grid">
                <div className="wf-emp-stat">
                  <span className="wf-emp-stat-value">{profile.training.completed}</span>
                  <span className="wf-emp-stat-label">Completed</span>
                </div>
                <div className="wf-emp-stat">
                  <span
                    className="wf-emp-stat-value"
                    style={{ color: profile.training.expiring_soon > 0 ? 'var(--danger)' : undefined }}
                  >
                    {profile.training.expiring_soon}
                  </span>
                  <span className="wf-emp-stat-label">Expiring Soon</span>
                </div>
                <div className="wf-emp-stat">
                  <span
                    className="wf-emp-stat-value"
                    style={{ color: profile.training.expired > 0 ? 'var(--danger)' : undefined }}
                  >
                    {profile.training.expired}
                  </span>
                  <span className="wf-emp-stat-label">Expired</span>
                </div>
              </div>
            </div>

            {/* Assets card */}
            <div className="wf-emp-card">
              <div className="wf-emp-card-title">Active Assets</div>
              <div className="wf-emp-stat">
                <span className="wf-emp-stat-value">{profile.assets.active_count}</span>
                <span className="wf-emp-stat-label">Equipment assigned</span>
              </div>
              {profile.assets.items.map(item => (
                <div key={item.id} className="wf-emp-asset-item">
                  <span className="wf-emp-asset-name">{item.asset_name}</span>
                  <span className="wf-badge">{CONDITION_LABELS[item.condition] ?? item.condition}</span>
                </div>
              ))}
              {profile.assets.active_count === 0 && (
                <span className="wf-emp-stat-label">No active assignments.</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
