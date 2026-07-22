import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { Link } from 'react-router-dom';
import { workforceApi, type Project } from '../../shared/api';
import { Button } from '../../../../components/ui/Button';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '../../../../components/ui/Feedback';
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
    setProjects(null);
    setError('');
    workforceApi.listProjects()
      .then((r) => setProjects(r.projects))
      .catch(() => setError('Failed to load projects.'));
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
      <WorkforceNav slug={slug} active="projects" />

      <div className="wf-page-heading">
        <div><h1>Projects</h1><p>Plan delivery work, assign resources, and track project health.</p></div>
      </div>
      {error && projects === null && <ErrorState title="Could not load projects." action={<Button size="compact" onClick={load}>Try again</Button>}>{error}</ErrorState>}
      {error && projects !== null && <InlineNotice tone="danger" title="The project could not be created." action={<Button size="compact" variant="quiet" onClick={() => setError('')}>Dismiss</Button>}>{error}</InlineNotice>}

      {canCreate && (
        <form className="wf-create-form" onSubmit={createProject}>
          <input
            type="text"
            placeholder="Project name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <Button type="submit" variant="primary" loading={creating} loadingLabel="Creating project…" disabled={!newName.trim()}>New project</Button>
        </form>
      )}

      {projects === null && !error && <LoadingState title="Loading projects…" />}
      {projects !== null && projects.length === 0 && (
        <EmptyState title="No projects yet.">Create one above to begin.</EmptyState>
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
