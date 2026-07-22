// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { Link } from 'react-router-dom';
import {
  workforceApi,
  type ComplianceRequirement,
  type ComplianceTask,
  type EmploymentType,
  type TrainingCourse,
  type TrainingCompletion,
  type StaffResource,
} from '../../shared/api';
import { findTeamMember, teamMembersFromResources, TeamEmployeePicker } from '../components/TeamBridge';
import { Button } from '../../../../components/ui/Button';
import { DateField } from '../../../../components/ui/DateTimeField';
import { EmptyState, ErrorState, InlineNotice, LoadingState, PermissionState } from '../../../../components/ui/Feedback';
import '../../workforce.css';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

type InnerTab = 'courses' | 'completions' | 'compliance';

export default function TrainingPage({ slug, perms }: Props) {
  const [innerTab, setInnerTab] = useState<InnerTab>('courses');

  const canCreate = perms.has('workforce.employees.create');
  const canEdit = perms.has('workforce.employees.edit');
  const canDelete = perms.has('workforce.employees.delete');
  const canComplianceView = perms.has('workforce.assets.view');
  const canComplianceCreate = perms.has('workforce.assets.create');

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="training" />

      <div className="wf-training-layout">
        <div className="wf-page-heading">
          <div><h1>Training</h1><p>Manage courses, completion evidence, and compliance work without losing operational context.</p></div>
        </div>
        {/* Inner tabs */}
        <div className="wf-training-inner-tabs">
          <button
            className={`wf-training-inner-tab${innerTab === 'courses' ? ' active' : ''}`}
            onClick={() => setInnerTab('courses')}
          >Courses</button>
          <button
            className={`wf-training-inner-tab${innerTab === 'completions' ? ' active' : ''}`}
            onClick={() => setInnerTab('completions')}
          >Completions</button>
          <button
            className={`wf-training-inner-tab${innerTab === 'compliance' ? ' active' : ''}`}
            onClick={() => setInnerTab('compliance')}
          >Compliance</button>
        </div>

        {innerTab === 'courses' && (
          <CoursesTab canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />
        )}
        {innerTab === 'completions' && (
          <CompletionsTab canCreate={canCreate} />
        )}
        {innerTab === 'compliance' && (
          <TrainingComplianceTab canView={canComplianceView} canCreate={canComplianceCreate} />
        )}
      </div>
    </div>
  );
}

// ─── Compliance Tab ──────────────────────────────────────────────────────────

function statusCounts(tasks: ComplianceTask[]) {
  return {
    pending: tasks.filter(t => t.status === 'pending').length,
    overdue: tasks.filter(t => t.status === 'overdue').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  };
}

function TrainingComplianceTab({ canView, canCreate }: { canView: boolean; canCreate: boolean }) {
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([]);
  const [tasks, setTasks] = useState<ComplianceTask[]>([]);
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [staff, setStaff] = useState<StaffResource[]>([]);
  const [error, setError] = useState('');
  const [formName, setFormName] = useState('');
  const [formCourseId, setFormCourseId] = useState('');
  const [formEmploymentType, setFormEmploymentType] = useState<EmploymentType | ''>('');
  const [formDueDays, setFormDueDays] = useState('');
  const [taskResourceId, setTaskResourceId] = useState('');
  const [taskUserNodeId, setTaskUserNodeId] = useState('');
  const [taskRequirementId, setTaskRequirementId] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskNotes, setTaskNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const teamMembers = teamMembersFromResources(staff);
  const counts = statusCounts(tasks);

  async function load() {
    if (!canView) return;
    setLoaded(false);
    setError('');
    try {
      const [ops, courseData, staffData] = await Promise.all([
        workforceApi.listComplianceOps(),
        workforceApi.listTrainingCourses(),
        workforceApi.listStaff(),
      ]);
      setRequirements(ops.requirements.filter(req => req.requirement_type === 'training'));
      setTasks(ops.tasks.filter(task => {
        const req = ops.requirements.find(r => r.id === task.requirement_id);
        return !req || req.requirement_type === 'training';
      }));
      setCourses(courseData.courses);
      setStaff(staffData.resources);
      setLoaded(true);
    } catch {
      setError('Failed to load compliance operations.');
    }
  }

  useEffect(() => { void load(); }, [canView]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createRequirement(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) { setFormError('Requirement name is required.'); return; }
    setSaving(true);
    setFormError('');
    try {
      await workforceApi.createComplianceRequirement({
        requirement_type: 'training',
        name: formName.trim(),
        course_id: formCourseId || null,
        required_for_employment_type: formEmploymentType || null,
        due_within_days: formDueDays ? Number(formDueDays) : null,
      });
      setFormName('');
      setFormCourseId('');
      setFormEmploymentType('');
      setFormDueDays('');
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create requirement.');
    } finally {
      setSaving(false);
    }
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    if (!taskResourceId) { setFormError('Select a staff resource.'); return; }
    setSaving(true);
    setFormError('');
    try {
      await workforceApi.createComplianceTask({
        resource_id: taskResourceId,
        requirement_id: taskRequirementId || null,
        user_node_id: taskUserNodeId || null,
        due_date: taskDueDate || null,
        source_type: 'manual',
        notes: taskNotes || null,
      });
      setTaskResourceId('');
      setTaskUserNodeId('');
      setTaskRequirementId('');
      setTaskDueDate('');
      setTaskNotes('');
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create task.');
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return <PermissionState title="Training compliance operations require asset/compliance access." />;
  }

  if (!loaded) {
    return error
      ? <ErrorState title="Could not load training compliance." action={<Button size="compact" onClick={() => void load()}>Try again</Button>}>{error}</ErrorState>
      : <LoadingState title="Loading training compliance…" />;
  }

  return (
    <div className="wf-compliance-layout">
      {formError && <InlineNotice tone="danger" title="The compliance change could not be saved.">{formError}</InlineNotice>}
      <section className="wf-attendance-board">
        <div className="wf-board-stat"><strong>{requirements.length}</strong><span>Training requirements</span></div>
        <div className="wf-board-stat"><strong>{counts.pending}</strong><span>Pending tasks</span></div>
        <div className="wf-board-stat"><strong>{counts.overdue}</strong><span>Overdue tasks</span></div>
        <div className="wf-board-stat"><strong>{counts.completed}</strong><span>Completed tasks</span></div>
      </section>

      <div className="wf-compliance-grid">
        <section className="wf-training-form">
          <h3 className="wf-section-title">Training Requirements</h3>
          {requirements.length === 0 && <EmptyState title="No training requirements configured." />}
          {requirements.map(req => (
            <div key={req.id} className="wf-compliance-row">
              <strong>{req.name}</strong>
              <span>{req.required_for_employment_type ?? 'All types'}{req.due_within_days !== null ? ` - due in ${req.due_within_days}d` : ''}</span>
            </div>
          ))}
          {canCreate && (
            <form className="wf-ot-form" onSubmit={createRequirement}>
              <label className="wf-label">Requirement name
                <input className="wf-input" value={formName} onChange={e => setFormName(e.target.value)} required />
              </label>
              <div className="wf-form-row">
                <label className="wf-label">Course
                  <select className="wf-select" value={formCourseId} onChange={e => setFormCourseId(e.target.value)}>
                    <option value="">No linked course</option>
                    {courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
                  </select>
                </label>
                <label className="wf-label">Employment type
                  <select className="wf-select" value={formEmploymentType} onChange={e => setFormEmploymentType(e.target.value as EmploymentType | '')}>
                    <option value="">All</option>
                    <option value="full_time">Full time</option>
                    <option value="part_time">Part time</option>
                    <option value="contractor">Contractor</option>
                    <option value="intern">Intern</option>
                  </select>
                </label>
                <label className="wf-label">Due within days
                  <input className="wf-input" type="number" min="0" value={formDueDays} onChange={e => setFormDueDays(e.target.value)} />
                </label>
              </div>
              <Button type="submit" variant="primary" loading={saving} loadingLabel="Saving requirement…">Create requirement</Button>
            </form>
          )}
        </section>

        <section className="wf-training-form">
          <h3 className="wf-section-title">Compliance Tasks</h3>
          {tasks.length === 0 && <EmptyState title="No training compliance tasks." />}
          {tasks.slice(0, 12).map(task => {
            const member = findTeamMember(staff, task.user_node_id);
            const resource = staff.find(s => s.id === task.resource_id);
            return (
              <div key={task.id} className="wf-compliance-row">
                <strong>{member?.display_name ?? resource?.name ?? task.resource_id}</strong>
                <span>{task.status}{task.due_date ? ` - due ${task.due_date}` : ''}</span>
              </div>
            );
          })}
          {canCreate && (
            <form className="wf-ot-form" onSubmit={createTask}>
              <div className="wf-form-row">
                <label className="wf-label">Staff resource
                  <select className="wf-select" value={taskResourceId} onChange={e => setTaskResourceId(e.target.value)} required>
                    <option value="">Select staff...</option>
                    {staff.map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                  </select>
                </label>
                <TeamEmployeePicker
                  label="Team user"
                  value={taskUserNodeId}
                  onChange={setTaskUserNodeId}
                  members={teamMembers}
                  blankLabel="No Team user"
                />
              </div>
              <div className="wf-form-row">
                <label className="wf-label">Requirement
                  <select className="wf-select" value={taskRequirementId} onChange={e => setTaskRequirementId(e.target.value)}>
                    <option value="">Manual task</option>
                    {requirements.map(req => <option key={req.id} value={req.id}>{req.name}</option>)}
                  </select>
                </label>
                <DateField label="Due date" value={taskDueDate} onChange={setTaskDueDate} />
              </div>
              <label className="wf-label">Notes
                <textarea className="wf-textarea" rows={2} value={taskNotes} onChange={e => setTaskNotes(e.target.value)} />
              </label>
              <Button type="submit" variant="primary" loading={saving} loadingLabel="Saving task…">Create task</Button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Courses Tab ──────────────────────────────────────────────────────────────

interface CoursesTabProps {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

function CoursesTab({ canCreate, canEdit, canDelete }: CoursesTabProps) {
  const [courses, setCourses] = useState<TrainingCourse[] | null>(null);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Create form
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formRequired, setFormRequired] = useState(false);
  const [formExpiry, setFormExpiry] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    setCourses(null);
    setError('');
    try {
      const data = await workforceApi.listTrainingCourses();
      setCourses(data.courses);
    } catch {
      setError('Failed to load courses.');
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) { setFormError('Name is required.'); return; }
    const expiryDays = formExpiry ? parseInt(formExpiry, 10) : undefined;
    if (formExpiry && (!expiryDays || expiryDays <= 0)) { setFormError('Expiry days must be a positive integer.'); return; }
    setSubmitting(true);
    setFormError('');
    try {
      await workforceApi.createTrainingCourse({
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        is_required: formRequired,
        expiry_days: expiryDays,
      });
      setFormName('');
      setFormDesc('');
      setFormRequired(false);
      setFormExpiry('');
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create course.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this course? All completions will also be removed.')) return;
    try {
      await workforceApi.deleteTrainingCourse(id);
      await load();
    } catch {
      setError('Failed to delete course.');
    }
  }

  return (
    <div>
      {error && courses === null && <ErrorState title="Could not load courses." action={<Button size="compact" onClick={() => void load()}>Try again</Button>}>{error}</ErrorState>}
      {error && courses !== null && <InlineNotice tone="danger" title="A course action could not be completed." action={<Button size="compact" variant="quiet" onClick={() => setError('')}>Dismiss</Button>}>{error}</InlineNotice>}
      {courses === null && !error && <LoadingState title="Loading courses…" />}
      {courses !== null && courses.length === 0 && <EmptyState title="No courses yet." />}

      {courses !== null && courses.length > 0 && (
        <div className="wf-course-list">
          {courses.map(c => (
            <div key={c.id} className="wf-course-card">
              <div className="wf-course-header">
                <span className="wf-course-name">{c.name}</span>
                <span className={c.is_required ? 'wf-badge-required' : 'wf-badge-optional'}>
                  {c.is_required ? 'Required' : 'Optional'}
                </span>
                {canEdit && (
                  <Button
                    size="compact"
                    variant="secondary"
                    onClick={() => setEditingId(editingId === c.id ? null : c.id)}
                  >
                    {editingId === c.id ? 'Cancel' : 'Edit'}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="compact"
                    variant="danger"
                    onClick={() => handleDelete(c.id)}
                  >Delete</Button>
                )}
              </div>
              {c.description && <div className="wf-course-desc">{c.description}</div>}
              <div className="wf-course-expiry">
                {c.expiry_days ? `Expires in ${c.expiry_days} days` : 'No expiry'}
              </div>
              {editingId === c.id && (
                <EditCourseForm
                  course={c}
                  onSaved={() => { setEditingId(null); load(); }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {canCreate && (
        <div className="wf-training-form" style={{ marginTop: '1.25rem' }}>
          <h3 className="wf-section-title">Add Course</h3>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {formError && <InlineNotice tone="danger" title="The course could not be created.">{formError}</InlineNotice>}
            <div className="wf-form-row">
              <label className="wf-label">Name *
                <input className="wf-input" value={formName} onChange={e => setFormName(e.target.value)} required />
              </label>
              <label className="wf-label">Expiry (days, optional)
                <input className="wf-input" type="number" min="1" value={formExpiry} onChange={e => setFormExpiry(e.target.value)} />
              </label>
            </div>
            <label className="wf-label">Description (optional)
              <textarea className="wf-textarea" rows={2} value={formDesc} onChange={e => setFormDesc(e.target.value)} />
            </label>
            <label className="wf-checkbox-row">
              <input type="checkbox" checked={formRequired} onChange={e => setFormRequired(e.target.checked)} />
              Required course
            </label>
            <Button type="submit" variant="primary" loading={submitting} loadingLabel="Creating course…">Create course</Button>
          </form>
        </div>
      )}
    </div>
  );
}

function EditCourseForm({ course, onSaved }: { course: TrainingCourse; onSaved: () => void }) {
  const [name, setName] = useState(course.name);
  const [desc, setDesc] = useState(course.description ?? '');
  const [required, setRequired] = useState(course.is_required);
  const [expiry, setExpiry] = useState(course.expiry_days?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr('');
    const expiryDays = expiry ? parseInt(expiry, 10) : null;
    try {
      await workforceApi.updateTrainingCourse(course.id, {
        name: name.trim() || course.name,
        description: desc.trim() || null,
        is_required: required,
        expiry_days: expiryDays ?? undefined,
      });
      onSaved();
    } catch (e2: unknown) {
      setErr(e2 instanceof Error ? e2.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem', padding: '0.75rem', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
      {err && <InlineNotice tone="danger" title="The course could not be saved.">{err}</InlineNotice>}
      <div className="wf-form-row">
        <label className="wf-label">Name
          <input className="wf-input" value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="wf-label">Expiry (days)
          <input className="wf-input" type="number" min="1" value={expiry} onChange={e => setExpiry(e.target.value)} />
        </label>
      </div>
      <label className="wf-label">Description
        <textarea className="wf-textarea" rows={2} value={desc} onChange={e => setDesc(e.target.value)} />
      </label>
      <label className="wf-checkbox-row">
        <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />
        Required
      </label>
      <Button type="submit" variant="primary" loading={saving} loadingLabel="Saving course…">Save changes</Button>
    </form>
  );
}

// ─── Completions Tab ──────────────────────────────────────────────────────────

interface CompletionsTabProps {
  canCreate: boolean;
}

function CompletionsTab({ canCreate }: CompletionsTabProps) {
  const [completions, setCompletions] = useState<TrainingCompletion[] | null>(null);
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [staff, setStaff] = useState<StaffResource[]>([]);
  const [filterResourceId, setFilterResourceId] = useState('');
  const [filterCourseId, setFilterCourseId] = useState('');
  const [filterExpiringSoon, setFilterExpiringSoon] = useState(false);
  const [error, setError] = useState('');

  // Log form
  const [formResourceId, setFormResourceId] = useState('');
  const [formCourseId, setFormCourseId] = useState('');
  const [formCompletedAt, setFormCompletedAt] = useState('');
  const [formCertUrl, setFormCertUrl] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    workforceApi.listStaff().then(d => setStaff(d.resources)).catch(() => {});
    workforceApi.listTrainingCourses().then(d => setCourses(d.courses)).catch(() => {});
  }, []);

  async function load() {
    setCompletions(null);
    setError('');
    try {
      const params: { resource_id?: string; course_id?: string; expiring_soon?: boolean } = {};
      if (filterResourceId) params.resource_id = filterResourceId;
      if (filterCourseId) params.course_id = filterCourseId;
      if (filterExpiringSoon) params.expiring_soon = true;
      const data = await workforceApi.listCompletions(params);
      setCompletions(data.completions);
    } catch {
      setError('Failed to load completions.');
    }
  }

  useEffect(() => { load(); }, [filterResourceId, filterCourseId, filterExpiringSoon]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasAlert = completions?.some(c => c.expiry_status === 'expired' || c.expiry_status === 'expiring_soon');

  async function handleLog(e: React.FormEvent) {
    e.preventDefault();
    if (!formResourceId) { setFormError('Select a staff member.'); return; }
    if (!formCourseId) { setFormError('Select a course.'); return; }
    if (!formCompletedAt) { setFormError('Completed date is required.'); return; }
    setSubmitting(true);
    setFormError('');
    try {
      await workforceApi.logCompletion({
        course_id: formCourseId,
        resource_id: formResourceId,
        completed_at: formCompletedAt,
        cert_url: formCertUrl || undefined,
        notes: formNotes || undefined,
      });
      setFormResourceId('');
      setFormCourseId('');
      setFormCompletedAt('');
      setFormCertUrl('');
      setFormNotes('');
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to log completion.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="wf-select" style={{ width: 'auto' }} value={filterResourceId} onChange={e => setFilterResourceId(e.target.value)}>
          <option value="">All staff</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="wf-select" style={{ width: 'auto' }} value={filterCourseId} onChange={e => setFilterCourseId(e.target.value)}>
          <option value="">All courses</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={filterExpiringSoon} onChange={e => setFilterExpiringSoon(e.target.checked)} />
          Expiring soon
        </label>
      </div>

      {hasAlert && (
        <div className="wf-expiry-alert">
          Some completions are expired or expiring within 30 days.
        </div>
      )}

      {error && completions === null && <ErrorState title="Could not load completions." action={<Button size="compact" onClick={() => void load()}>Try again</Button>}>{error}</ErrorState>}
      {error && completions !== null && <InlineNotice tone="danger" title="A completion action could not be completed." action={<Button size="compact" variant="quiet" onClick={() => setError('')}>Dismiss</Button>}>{error}</InlineNotice>}
      {completions === null && !error && <LoadingState title="Loading completions…" />}
      {completions !== null && completions.length === 0 && <EmptyState title="No completions found." />}

      {completions !== null && completions.length > 0 && (
        <div className="wf-completion-list">
          {completions.map(c => (
            <div key={c.id} className="wf-completion-card">
              <div className="wf-completion-header">
                <span className="wf-completion-resource">{c.resource_name ?? c.resource_id}</span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{c.course_name}</span>
                <span className={`wf-badge-${c.expiry_status === 'expiring_soon' ? 'expiring-soon' : c.expiry_status}`}>
                  {c.expiry_status === 'expiring_soon' ? 'Expiring soon' : c.expiry_status.charAt(0).toUpperCase() + c.expiry_status.slice(1)}
                </span>
              </div>
              <div className="wf-completion-dates">
                Completed: {c.completed_at}
                {c.expires_at && ` · Expires: ${c.expires_at}`}
              </div>
              {c.cert_url && (
                <div style={{ fontSize: '0.85rem' }}>
                  <a href={c.cert_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                    View certificate
                  </a>
                </div>
              )}
              {c.notes && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{c.notes}</div>}
            </div>
          ))}
        </div>
      )}

      {canCreate && (
        <div className="wf-training-form">
          <h3 className="wf-section-title">Log Completion</h3>
          <form onSubmit={handleLog} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {formError && <InlineNotice tone="danger" title="The completion could not be logged.">{formError}</InlineNotice>}
            <div className="wf-form-row">
              <label className="wf-label">Staff member *
                <select className="wf-select" value={formResourceId} onChange={e => setFormResourceId(e.target.value)} required>
                  <option value="">Select staff…</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="wf-label">Course *
                <select className="wf-select" value={formCourseId} onChange={e => setFormCourseId(e.target.value)} required>
                  <option value="">Select course…</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <DateField label="Completed date" value={formCompletedAt} onChange={setFormCompletedAt} required />
            </div>
            <label className="wf-label">Certificate URL (optional)
              <input className="wf-input" type="url" value={formCertUrl} onChange={e => setFormCertUrl(e.target.value)} />
            </label>
            <label className="wf-label">Notes (optional)
              <textarea className="wf-textarea" rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)} />
            </label>
            <Button type="submit" variant="primary" loading={submitting} loadingLabel="Logging completion…">Log completion</Button>
          </form>
        </div>
      )}
    </div>
  );
}
