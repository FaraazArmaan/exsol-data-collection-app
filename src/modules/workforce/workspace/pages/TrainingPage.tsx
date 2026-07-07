// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { Link } from 'react-router-dom';
import {
  workforceApi,
  type TrainingCourse,
  type TrainingCompletion,
  type StaffResource,
} from '../../shared/api';
import '../../workforce.css';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

type InnerTab = 'courses' | 'completions';

export default function TrainingPage({ slug, perms }: Props) {
  const [innerTab, setInnerTab] = useState<InnerTab>('courses');

  const canCreate = perms.has('workforce.employees.create');
  const canEdit = perms.has('workforce.employees.edit');
  const canDelete = perms.has('workforce.employees.delete');

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="training" />

      <div className="wf-training-layout">
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
        </div>

        {innerTab === 'courses' && (
          <CoursesTab canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />
        )}
        {innerTab === 'completions' && (
          <CompletionsTab canCreate={canCreate} />
        )}
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
      {error && <div className="wf-error">{error}</div>}
      {courses === null && !error && <div className="wf-loading">Loading courses…</div>}
      {courses !== null && courses.length === 0 && <div className="wf-empty">No courses yet.</div>}

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
                  <button
                    className="wf-btn"
                    onClick={() => setEditingId(editingId === c.id ? null : c.id)}
                    style={{ fontSize: '0.8rem', padding: '2px 10px' }}
                  >
                    {editingId === c.id ? 'Cancel' : 'Edit'}
                  </button>
                )}
                {canDelete && (
                  <button
                    className="wf-btn wf-btn-danger"
                    onClick={() => handleDelete(c.id)}
                    style={{ fontSize: '0.8rem', padding: '2px 10px' }}
                  >Delete</button>
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
            {formError && <div className="wf-error">{formError}</div>}
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
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              <input type="checkbox" checked={formRequired} onChange={e => setFormRequired(e.target.checked)} />
              Required course
            </label>
            <button className="wf-btn wf-btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create course'}
            </button>
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
      {err && <div className="wf-error">{err}</div>}
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
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />
        Required
      </label>
      <button className="wf-btn wf-btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
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

      {error && <div className="wf-error">{error}</div>}
      {completions === null && !error && <div className="wf-loading">Loading completions…</div>}
      {completions !== null && completions.length === 0 && <div className="wf-empty">No completions found.</div>}

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
            {formError && <div className="wf-error">{formError}</div>}
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
              <label className="wf-label">Completed date *
                <input className="wf-input" type="date" value={formCompletedAt} onChange={e => setFormCompletedAt(e.target.value)} required />
              </label>
            </div>
            <label className="wf-label">Certificate URL (optional)
              <input className="wf-input" type="url" value={formCertUrl} onChange={e => setFormCertUrl(e.target.value)} />
            </label>
            <label className="wf-label">Notes (optional)
              <textarea className="wf-textarea" rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)} />
            </label>
            <button className="wf-btn wf-btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Logging…' : 'Log completion'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
