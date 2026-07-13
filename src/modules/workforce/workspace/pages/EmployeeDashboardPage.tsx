// @vitest-environment jsdom
import { useEffect, useMemo, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import {
  workforceApi,
  type EmployeeMasterProfile,
  type EmployeeProfile,
  type EmploymentStatus,
  type EmploymentType,
  type StaffResource,
} from '../../shared/api';
import {
  findTeamMember,
  teamMembersFromResources,
  TeamEmployeePicker,
  TeamStatusCard,
} from '../components/TeamBridge';
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

const STATUS_LABELS: Record<EmploymentStatus, string> = {
  active: 'Active',
  on_leave: 'On leave',
  terminated: 'Terminated',
};

const TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contractor: 'Contractor',
  intern: 'Intern',
};

interface MasterForm {
  user_node_id: string;
  employee_number: string;
  legal_name: string;
  preferred_name: string;
  employment_status: EmploymentStatus;
  employment_type: EmploymentType;
  job_title: string;
  department: string;
  hire_date: string;
  termination_date: string;
  manager_user_node_id: string;
  primary_email: string;
  primary_phone: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relationship: string;
}

const blankForm: MasterForm = {
  user_node_id: '',
  employee_number: '',
  legal_name: '',
  preferred_name: '',
  employment_status: 'active',
  employment_type: 'full_time',
  job_title: '',
  department: '',
  hire_date: '',
  termination_date: '',
  manager_user_node_id: '',
  primary_email: '',
  primary_phone: '',
  emergency_name: '',
  emergency_phone: '',
  emergency_relationship: '',
};

function textFromRecord(record: Record<string, unknown> | null | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' ? value : '';
}

function formFromProfile(profile: EmployeeMasterProfile | null, resource: StaffResource | undefined): MasterForm {
  if (!profile) {
    return {
      ...blankForm,
      legal_name: resource?.name ?? '',
    };
  }
  return {
    user_node_id: profile.user_node_id ?? '',
    employee_number: profile.employee_number ?? '',
    legal_name: profile.legal_name,
    preferred_name: profile.preferred_name ?? '',
    employment_status: profile.employment_status,
    employment_type: profile.employment_type,
    job_title: profile.job_title ?? '',
    department: profile.department ?? '',
    hire_date: profile.hire_date ?? '',
    termination_date: profile.termination_date ?? '',
    manager_user_node_id: profile.manager_user_node_id ?? '',
    primary_email: profile.primary_email ?? '',
    primary_phone: profile.primary_phone ?? '',
    emergency_name: textFromRecord(profile.emergency_contact, 'name'),
    emergency_phone: textFromRecord(profile.emergency_contact, 'phone'),
    emergency_relationship: textFromRecord(profile.emergency_contact, 'relationship'),
  };
}

function completeness(master: EmployeeMasterProfile | null): { done: number; total: number; missing: string[] } {
  const checks: Array<[boolean, string]> = [
    [!!master?.user_node_id, 'Team user link'],
    [!!master?.employee_number, 'Employee number'],
    [!!master?.job_title, 'Job title'],
    [!!master?.department, 'Department'],
    [!!master?.hire_date, 'Hire date'],
    [!!master?.manager_user_node_id, 'Manager'],
    [!!master?.primary_email || !!master?.primary_phone, 'Contact'],
    [Object.keys(master?.emergency_contact ?? {}).length > 0, 'Emergency contact'],
  ];
  return {
    done: checks.filter(([ok]) => ok).length,
    total: checks.length,
    missing: checks.filter(([ok]) => !ok).map(([, label]) => label),
  };
}

export default function EmployeeDashboardPage({ slug, perms }: Props) {
  const [staff, setStaff] = useState<StaffResource[]>([]);
  const [masters, setMasters] = useState<EmployeeMasterProfile[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [form, setForm] = useState<MasterForm>(blankForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');

  const canSave = perms.has('workforce.employees.create');
  const teamMembers = useMemo(() => teamMembersFromResources(staff), [staff]);
  const selectedResource = staff.find(s => s.id === selectedResourceId);
  const selectedMaster = masters.find(m => m.resource_id === selectedResourceId) ?? null;
  const selectedTeamMember = findTeamMember(staff, selectedMaster?.user_node_id ?? form.user_node_id);
  const managerMember = findTeamMember(staff, selectedMaster?.manager_user_node_id ?? form.manager_user_node_id);
  const completion = completeness(selectedMaster);

  async function loadMasterProfiles() {
    const data = await workforceApi.listEmployeeMaster();
    setMasters(data.profiles);
  }

  useEffect(() => {
    Promise.all([
      workforceApi.listStaff(),
      workforceApi.listEmployeeMaster(),
    ]).then(([staffData, masterData]) => {
      setStaff(staffData.resources);
      setMasters(masterData.profiles);
    }).catch(() => {
      setError('Failed to load employee directory.');
    });
  }, []);

  useEffect(() => {
    setForm(formFromProfile(selectedMaster, selectedResource));
  }, [selectedMaster, selectedResource]);

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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedResourceId) return;
    if (!form.legal_name.trim()) {
      setFormError('Legal name is required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await workforceApi.saveEmployeeMaster({
        resource_id: selectedResourceId,
        user_node_id: form.user_node_id || null,
        employee_number: form.employee_number || null,
        legal_name: form.legal_name.trim(),
        preferred_name: form.preferred_name || null,
        employment_status: form.employment_status,
        employment_type: form.employment_type,
        job_title: form.job_title || null,
        department: form.department || null,
        hire_date: form.hire_date || null,
        termination_date: form.termination_date || null,
        manager_user_node_id: form.manager_user_node_id || null,
        primary_email: form.primary_email || null,
        primary_phone: form.primary_phone || null,
        emergency_contact: {
          name: form.emergency_name,
          phone: form.emergency_phone,
          relationship: form.emergency_relationship,
        },
        custom_fields: {},
      });
      await loadMasterProfiles();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save employee profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="employees" />

      <div className="wf-page-heading">
        <div>
          <h1>Employee Tracking</h1>
          <p>Employee 360 records extend Team identity with employment, readiness, and operational context.</p>
        </div>
        <div className="wf-emp-select-row">
          <span className="wf-emp-select-label">Staff member</span>
          <select
            className="wf-select"
            value={selectedResourceId}
            onChange={e => setSelectedResourceId(e.target.value)}
          >
            <option value="">Select staff...</option>
            {staff.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {!selectedResourceId && (
        <div className="wf-emp-empty">Select a staff member to view or complete their employee profile.</div>
      )}

      {selectedResourceId && (
        <div className="wf-emp-layout">
          {error && <div className="wf-error">{error}</div>}

          <div className="wf-emp-profile-grid">
            <section className="wf-emp-card wf-emp-card-wide">
              <div className="wf-emp-card-title">Team Link</div>
              <TeamStatusCard slug={slug} member={selectedTeamMember} emptyText="No Team user linked to this employee profile." />
              {managerMember && (
                <div className="wf-emp-manager-line">
                  Manager: {managerMember.display_name}{managerMember.email ? ` - ${managerMember.email}` : ''}
                </div>
              )}
            </section>

            <section className="wf-emp-card">
              <div className="wf-emp-card-title">Profile Completeness</div>
              <div className="wf-emp-completion">
                <span className="wf-emp-stat-value">{completion.done}/{completion.total}</span>
                <span className="wf-emp-stat-label">Fields complete</span>
              </div>
              {completion.missing.length > 0 ? (
                <div className="wf-emp-balance-row">
                  {completion.missing.map(item => (
                    <span key={item} className="wf-emp-balance-chip">{item}</span>
                  ))}
                </div>
              ) : (
                <span className="wf-badge-ontime">Ready</span>
              )}
            </section>

            <section className="wf-emp-card">
              <div className="wf-emp-card-title">Employment State</div>
              <div className="wf-emp-stat">
                <span className="wf-emp-stat-value" style={{ fontSize: '1.1rem' }}>
                  {selectedMaster ? STATUS_LABELS[selectedMaster.employment_status] : 'Not created'}
                </span>
                <span className="wf-emp-stat-label">
                  {selectedMaster ? TYPE_LABELS[selectedMaster.employment_type] : 'Create a master profile'}
                </span>
              </div>
              {selectedMaster?.department && <div className="wf-team-meta">{selectedMaster.department}</div>}
              {selectedMaster?.job_title && <div className="wf-team-meta">{selectedMaster.job_title}</div>}
            </section>
          </div>

          <section className="wf-emp-card">
            <div className="wf-emp-card-title">Master Profile</div>
            <form className="wf-employee-form" onSubmit={handleSave}>
              {formError && <div className="wf-error">{formError}</div>}
              <div className="wf-form-row">
                <TeamEmployeePicker
                  label="Linked Team user"
                  value={form.user_node_id}
                  onChange={value => setForm(prev => ({ ...prev, user_node_id: value }))}
                  members={teamMembers}
                  blankLabel="No Team user link"
                />
                <TeamEmployeePicker
                  label="Manager"
                  value={form.manager_user_node_id}
                  onChange={value => setForm(prev => ({ ...prev, manager_user_node_id: value }))}
                  members={teamMembers}
                  blankLabel="No manager"
                />
                <label className="wf-label">Employee number
                  <input className="wf-input" value={form.employee_number} onChange={e => setForm(prev => ({ ...prev, employee_number: e.target.value }))} />
                </label>
              </div>
              <div className="wf-form-row">
                <label className="wf-label">Legal name
                  <input className="wf-input" value={form.legal_name} onChange={e => setForm(prev => ({ ...prev, legal_name: e.target.value }))} required />
                </label>
                <label className="wf-label">Preferred name
                  <input className="wf-input" value={form.preferred_name} onChange={e => setForm(prev => ({ ...prev, preferred_name: e.target.value }))} />
                </label>
                <label className="wf-label">Job title
                  <input className="wf-input" value={form.job_title} onChange={e => setForm(prev => ({ ...prev, job_title: e.target.value }))} />
                </label>
              </div>
              <div className="wf-form-row">
                <label className="wf-label">Department
                  <input className="wf-input" value={form.department} onChange={e => setForm(prev => ({ ...prev, department: e.target.value }))} />
                </label>
                <label className="wf-label">Status
                  <select className="wf-select" value={form.employment_status} onChange={e => setForm(prev => ({ ...prev, employment_status: e.target.value as EmploymentStatus }))}>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="wf-label">Employment type
                  <select className="wf-select" value={form.employment_type} onChange={e => setForm(prev => ({ ...prev, employment_type: e.target.value as EmploymentType }))}>
                    {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>
              <div className="wf-form-row">
                <label className="wf-label">Hire date
                  <input className="wf-input" type="date" value={form.hire_date} onChange={e => setForm(prev => ({ ...prev, hire_date: e.target.value }))} />
                </label>
                <label className="wf-label">Termination date
                  <input className="wf-input" type="date" value={form.termination_date} onChange={e => setForm(prev => ({ ...prev, termination_date: e.target.value }))} />
                </label>
                <label className="wf-label">Primary email
                  <input className="wf-input" type="email" value={form.primary_email} onChange={e => setForm(prev => ({ ...prev, primary_email: e.target.value }))} />
                </label>
                <label className="wf-label">Primary phone
                  <input className="wf-input" value={form.primary_phone} onChange={e => setForm(prev => ({ ...prev, primary_phone: e.target.value }))} />
                </label>
              </div>
              <div className="wf-form-row">
                <label className="wf-label">Emergency contact
                  <input className="wf-input" value={form.emergency_name} onChange={e => setForm(prev => ({ ...prev, emergency_name: e.target.value }))} />
                </label>
                <label className="wf-label">Emergency phone
                  <input className="wf-input" value={form.emergency_phone} onChange={e => setForm(prev => ({ ...prev, emergency_phone: e.target.value }))} />
                </label>
                <label className="wf-label">Relationship
                  <input className="wf-input" value={form.emergency_relationship} onChange={e => setForm(prev => ({ ...prev, emergency_relationship: e.target.value }))} />
                </label>
              </div>
              {canSave ? (
                <button className="wf-btn wf-btn-primary" type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save employee profile'}
                </button>
              ) : (
                <div className="wf-emp-stat-label">You can view employee profiles, but cannot edit them.</div>
              )}
            </form>
          </section>

          {loading && <div className="wf-emp-loading">Loading operational profile...</div>}
          {!loading && !error && profile && (
            <div className="wf-emp-grid">
              <div className="wf-emp-card">
                <div className="wf-emp-card-title">This Week</div>
                <div className="wf-emp-stats-grid">
                  <div className="wf-emp-stat"><span className="wf-emp-stat-value">{profile.this_week.shifts}</span><span className="wf-emp-stat-label">Shifts</span></div>
                  <div className="wf-emp-stat"><span className="wf-emp-stat-value">{profile.this_week.punches}</span><span className="wf-emp-stat-label">Punches</span></div>
                  <div className="wf-emp-stat"><span className="wf-emp-stat-value">{profile.this_week.hours_worked.toFixed(1)}</span><span className="wf-emp-stat-label">Hours</span></div>
                  <div className="wf-emp-stat"><span className="wf-emp-stat-value">{profile.this_week.ot_hours.toFixed(1)}</span><span className="wf-emp-stat-label">OT</span></div>
                </div>
                {profile.this_week.on_leave && <span className="wf-emp-on-leave">On Leave</span>}
              </div>

              <div className="wf-emp-card">
                <div className="wf-emp-card-title">Leave</div>
                <div className="wf-emp-stats-grid">
                  <div className="wf-emp-stat"><span className="wf-emp-stat-value">{profile.leave.pending}</span><span className="wf-emp-stat-label">Pending</span></div>
                  <div className="wf-emp-stat"><span className="wf-emp-stat-value">{profile.leave.approved_this_month}</span><span className="wf-emp-stat-label">Approved this month</span></div>
                </div>
                <div className="wf-emp-balance-row">
                  {profile.leave.balances.map(b => (
                    <span key={b.leave_type} className="wf-emp-balance-chip">{LEAVE_LABELS[b.leave_type] ?? b.leave_type}: {b.balance_days}d</span>
                  ))}
                </div>
              </div>

              <div className="wf-emp-card">
                <div className="wf-emp-card-title">Training</div>
                <div className="wf-emp-stats-grid">
                  <div className="wf-emp-stat"><span className="wf-emp-stat-value">{profile.training.completed}</span><span className="wf-emp-stat-label">Completed</span></div>
                  <div className="wf-emp-stat"><span className="wf-emp-stat-value">{profile.training.expiring_soon}</span><span className="wf-emp-stat-label">Expiring</span></div>
                  <div className="wf-emp-stat"><span className="wf-emp-stat-value">{profile.training.expired}</span><span className="wf-emp-stat-label">Expired</span></div>
                </div>
              </div>

              <div className="wf-emp-card">
                <div className="wf-emp-card-title">Active Assets</div>
                <div className="wf-emp-stat"><span className="wf-emp-stat-value">{profile.assets.active_count}</span><span className="wf-emp-stat-label">Equipment assigned</span></div>
                {profile.assets.items.map(item => (
                  <div key={item.id} className="wf-emp-asset-item">
                    <span className="wf-emp-asset-name">{item.asset_name}</span>
                    <span className="wf-badge">{CONDITION_LABELS[item.condition] ?? item.condition}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
