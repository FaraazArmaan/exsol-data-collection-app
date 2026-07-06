import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { workforceApi, type Project, type ProjectAssignment, type ProjectStatus, type StaffResource } from '../../api';
import '../../workforce.css';

const FSM_NEXT: Record<ProjectStatus, ProjectStatus | null> = {
  quoted: 'active',
  active: 'done',
  done: null,
};

const FSM_LABEL: Record<ProjectStatus, string> = {
  quoted: 'Mark Active',
  active: 'Mark Done',
  done: 'Done',
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`wf-status-badge ${status}`}>{status}</span>;
}

interface Props {
  slug: string;
  projectId: string;
  perms: ReadonlySet<string>;
}

export default function ProjectDetailPage({ slug, projectId, perms }: Props) {
  const canEdit = perms.has('project-service.business.edit');
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [assignments, setAssignments] = useState<ProjectAssignment[]>([]);
  const [resources, setResources] = useState<StaffResource[]>([]);
  const [selectedResource, setSelectedResource] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');

  function load() {
    workforceApi.getProject(projectId)
      .then(({ project: p, assignments: a }) => {
        setProject(p);
        setAssignments(a);
      })
      .catch(() => setError('Failed to load project.'));
    workforceApi.listStaff()
      .then((r) => setResources(r.resources.filter((x) => x.active)))
      .catch(() => {});
  }

  useEffect(load, [projectId]);

  async function advance() {
    if (!project) return;
    const next = FSM_NEXT[project.status];
    if (!next) return;
    setAdvancing(true);
    setError('');
    try {
      await workforceApi.advanceStatus(project.id, next);
      load();
    } catch {
      setError('Could not advance status.');
    } finally {
      setAdvancing(false);
    }
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedResource || !project) return;
    setAssigning(true);
    setError('');
    try {
      await workforceApi.assignResource(project.id, selectedResource);
      setSelectedResource('');
      load();
    } catch {
      setError('Could not assign resource.');
    } finally {
      setAssigning(false);
    }
  }

  async function unassign(resourceId: string) {
    if (!project) return;
    setError('');
    try {
      await workforceApi.unassignResource(project.id, resourceId);
      load();
    } catch {
      setError('Could not unassign resource.');
    }
  }

  if (!project && !error) return <div className="wf-page"><p>Loading…</p></div>;
  if (error && !project) return <div className="wf-page"><p className="wf-error">{error}</p></div>;

  const nextStatus = FSM_NEXT[project!.status];
  const assignedIds = new Set(assignments.map((a) => a.resource_id));
  const availableResources = resources.filter((r) => !assignedIds.has(r.id));

  return (
    <div className="wf-page">
      <Link to={`/c/${slug}/workforce/projects`} className="wf-back-link">← Projects</Link>

      <div className="wf-detail-header">
        <h2>{project!.name}</h2>
        <StatusBadge status={project!.status} />
        {canEdit && nextStatus && (
          <button className="wf-advance-btn" onClick={advance} disabled={advancing}>
            {advancing ? '…' : FSM_LABEL[project!.status]}
          </button>
        )}
      </div>

      {project!.customer_name && (
        <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0 0 16px' }}>
          Customer: {project!.customer_name}
        </p>
      )}

      {error && <p className="wf-error">{error}</p>}

      {/* Resource assignments */}
      <div className="wf-section">
        <h3>Assigned Resources</h3>

        {canEdit && availableResources.length > 0 && project!.status !== 'done' && (
          <form className="wf-create-form" onSubmit={assign} style={{ marginBottom: 12 }}>
            <select
              value={selectedResource}
              onChange={(e) => setSelectedResource(e.target.value)}
              required
            >
              <option value="">Select a resource…</option>
              {availableResources.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button type="submit" disabled={assigning || !selectedResource}>
              {assigning ? 'Assigning…' : 'Assign'}
            </button>
          </form>
        )}

        {assignments.length === 0 && (
          <p className="wf-empty">No resources assigned yet.</p>
        )}

        <div className="wf-assignment-list">
          {assignments.map((a) => (
            <div key={a.resource_id} className="wf-assignment-row">
              <span>{a.resource_name}</span>
              {canEdit && project!.status !== 'done' && (
                <button onClick={() => unassign(a.resource_id)}>Remove</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
