import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { workforceApi, type Project } from '../../api';
import '../../workforce.css';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`wf-status-badge ${status}`}>{status}</span>;
}

export default function ProjectsPage({ slug, perms }: Props) {
  const canCreate = perms.has('project-service.business.create');

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  function load() {
    workforceApi.listProjects()
      .then((r) => setProjects(r.projects))
      .catch(() => { setProjects([]); setError('Failed to load projects.'); });
  }

  useEffect(load, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    try {
      await workforceApi.createProject({ name: newName.trim() });
      setNewName('');
      load();
    } catch {
      setError('Could not create project.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="wf-page">
      <div className="wf-tabs">
        <Link to={`/c/${slug}/workforce`} className="wf-tab" style={{ textDecoration: 'none' }}>
          Staff & Schedule
        </Link>
        <button className="wf-tab active">Projects</button>
      </div>

      <h1>Projects</h1>
      {error && <p className="wf-error">{error}</p>}

      {canCreate && (
        <form className="wf-create-form" onSubmit={createProject}>
          <input
            type="text"
            placeholder="Project name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <button type="submit" disabled={creating || !newName.trim()}>
            {creating ? 'Creating…' : 'New project'}
          </button>
        </form>
      )}

      {projects === null && <p>Loading…</p>}
      {projects !== null && projects.length === 0 && (
        <p className="wf-empty">No projects yet. Create one above.</p>
      )}

      <div className="wf-project-list">
        {(projects ?? []).map((p) => (
          <Link
            key={p.id}
            to={`/c/${slug}/workforce/projects/${p.id}`}
            className="wf-project-card"
          >
            <div>
              <div className="wf-project-name">{p.name}</div>
              {p.customer_name && (
                <div className="wf-project-meta">Customer: {p.customer_name}</div>
              )}
            </div>
            <StatusBadge status={p.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}
